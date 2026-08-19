/**
 * dsh-mnemon-gc —— Mnemon 记忆体 GC 治理插件（宿主半区，Node）。
 *
 * 基于 dsh-mnemon 的公共 API（createRunner / resolveConfig）：
 *   - 巡检：mnemon gc --readonly，只读，绝不写库；
 *   - 分级：immune / stale / watch（引擎层纯函数，语义见 lib/engine.js）；
 *   - 清理：mnemon forget <id>（软删除），只在显式 purge 时执行。
 *
 * 触发（决策 D 混合）：
 *   - 自动巡检：每个 root agent 的 turn-stopping 后，距上次巡检 >= intervalMs 才跑；
 *     自动巡检**只报告**，绝不删除（安全默认）。
 *   - 手动工具 mnemon_gc_inspect / mnemon_gc_purge：模型显式调用；
 *   - 命令 /mnemon-gc inspect|purge：用户显式调用。
 *
 * 生命周期：mirror schedule 的 pattern——agent/created 是全局事件，
 * turn-stopping 是 per-agent；用 Map 按 agent 登记监听器，agent 销毁时自动清理。
 */

import { createRunner, resolveConfig } from 'dsh-mnemon'
import { DEFAULT_MAX_AGE_DAYS, DEFAULT_THRESHOLD, validatePolicy } from './engine.js'
import { runInspection, runPurge } from './orchestrator.js'

export const name = 'dsh-mnemon-gc'
export const inject = ['tools', 'commands', 'agents']

export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_MS = 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 校验并归一化插件配置。保留 cliPath/dataDir（不丢弃）。
 * 默认不硬编码开发机路径：cliPath 缺省交给 dsh-mnemon 的 findMnemonCommand 解析
 * （MNEMON_CLI_PATH / PATH / 常见路径）；仅当调用方显式传入才覆盖。
 */
export function normalizeConfig(raw = {}) {
  const threshold = raw.threshold === undefined ? DEFAULT_THRESHOLD : Number(raw.threshold)
  const maxAgeDays = raw.maxAgeDays === undefined ? DEFAULT_MAX_AGE_DAYS : Number(raw.maxAgeDays)
  const intervalMs = raw.intervalMs === undefined ? DEFAULT_INTERVAL_MS : Number(raw.intervalMs)
  const limit = raw.limit === undefined ? 500 : Number(raw.limit)
  const cliPath = raw.cliPath === undefined || raw.cliPath === '' ? undefined : String(raw.cliPath)
  const dataDir = raw.dataDir === undefined || raw.dataDir === '' ? undefined : String(raw.dataDir)

  const policy = validatePolicy({ threshold, maxAgeDays })
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new TypeError(`intervalMs must be within [${MIN_INTERVAL_MS}, ${MAX_INTERVAL_MS}], got ${String(intervalMs)}`)
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new TypeError(`limit must be an integer within [1, 1000], got ${String(limit)}`)
  }
  return { ...policy, intervalMs, limit, cliPath, dataDir }
}

/** 从 dsh-mnemon 解析 runner；cliPath/dataDir 仅在显式配置时覆盖。
 *  注意：dsh-mnemon 的 createRunner 仅在 storageScope==='custom' 时使用 dataDir；
 *  因此显式 dataDir 必须配 custom scope，否则会静默回退到 ~/.mnemon。 */
export function resolveRunner(config) {
  const storageScope = config.dataDir ? 'custom' : 'global'
  const resolved = resolveConfig({
    storageScope,
    ...(config.cliPath ? { cliPath: config.cliPath } : {}),
    ...(config.dataDir ? { dataDir: config.dataDir } : {}),
  })
  return createRunner(resolved)
}

/** 把巡检报告压成一行可读文本（logger 输出，不打扰会话）。 */
function renderReport(report) {
  const { tiers, totalInsights, candidatesFound } = report
  return `[mnemon-gc] ${report.store}: insights=${totalInsights} candidates=${candidatesFound} stale=${tiers.stale} watch=${tiers.watch} immune=${tiers.immune}`
}

/**
 * Cordis 插件入口。
 * @param ctx 宿主 Context（tools/commands/agents 由 inject 提供）
 * @param config 插件配置（来自 cordis.patch.yml）
 */
export function apply(ctx, config = {}) {
  const normalized = normalizeConfig(config)
  const runner = resolveRunner(normalized)
  const policy = { threshold: normalized.threshold, maxAgeDays: normalized.maxAgeDays }

  // 进程内状态：上次巡检时间戳 + 进行中的巡检（串行化，避免并发/TOCTOU）。
  let lastInspectionAt = 0
  let inspectionInFlight = null
  let stopping = false

  /** 后台自动巡检：**只报告**，绝不删除。失败仅记日志。 */
  async function autoInspect() {
    if (stopping || inspectionInFlight) return
    const run = (async () => {
      try {
        const report = await runInspection(runner, policy, { store: 'default', limit: normalized.limit })
        ctx.logger.info(renderReport(report))
      } catch (error) {
        ctx.logger.warn(`[mnemon-gc] auto inspection failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
    inspectionInFlight = run
    try { await run } finally { inspectionInFlight = null }
  }

  // 按 agent 用 agent.ctx.effect 登记 turn-stopping 监听器（mirror schedule 模式）。
  // effect 随 agent 销毁自动清理；cleanup 里从 Map 删除条目，避免泄漏。
  const attached = new Map()
  const attach = (agent) => {
    if (attached.has(agent)) return
    const cleanup = agent.ctx.effect(() => {
      const stopTurn = agent.ctx.on('agent/turn-stopping', () => {
        const now = Date.now()
        if (now - lastInspectionAt >= normalized.intervalMs) {
          lastInspectionAt = now
          void autoInspect()
        }
      })
      return () => {
        stopTurn()
        if (attached.get(agent) === cleanup) attached.delete(agent)
      }
    }, 'mnemon-gc.turn()')
    attached.set(agent, cleanup)
  }

  // 未来 root agent：agent/created 时挂载。
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (!ctx.agents.roots().includes(agent)) return
    attach(agent)
  })

  // 已存在的 root agent：挂载时补挂（修复 MEDIUM#9）。
  for (const agent of ctx.agents.roots()) attach(agent)

  // 手动工具：巡检（只读）
  ctx.tools.register({
    name: 'mnemon_gc_inspect',
    description: 'Inspect Mnemon memory stores for retention candidates using the native decay model. Read-only; returns immune/stale/watch tiers. Does not delete anything.',
    parameters: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Mnemon store name; omit for the default store.' },
      },
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args) => {
      const store = args?.store ? String(args.store) : 'default'
      return runInspection(runner, policy, { store, limit: normalized.limit })
    },
  })

  // 手动工具：清理 stale（软删除，显式触发）
  ctx.tools.register({
    name: 'mnemon_gc_purge',
    description: 'Soft-delete Mnemon insights that are non-immune, below the effective-importance threshold, and unaccessed for at least maxAgeDays. Uses mnemon forget (soft delete). Destructive; only call with explicit intent.',
    parameters: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Mnemon store name; omit for the default store.' },
      },
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args) => {
      const store = args?.store ? String(args.store) : 'default'
      return runPurge(runner, policy, { store, limit: normalized.limit })
    },
  })

  // 手动命令：/mnemon-gc inspect|purge
  ctx.commands.register({
    name: 'mnemon-gc',
    description: 'Inspect or purge Mnemon retention candidates',
    input: { hint: '[inspect|purge] [store]' },
    async handler(invocation) {
      const [op, storeArg] = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
      const store = storeArg || 'default'
      try {
        if (op === 'inspect') {
          const report = await runInspection(runner, policy, { store, limit: normalized.limit })
          return { kind: 'success', text: JSON.stringify(report, null, 2) }
        }
        if (op === 'purge') {
          const report = await runPurge(runner, policy, { store, limit: normalized.limit })
          return { kind: 'success', text: JSON.stringify(report, null, 2) }
        }
        return { kind: 'error', text: 'usage: /mnemon-gc [inspect|purge] [store]' }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // 清理：停止自动巡检，移除全局监听，并让每个 agent 的 effect 自行清理。
  return async () => {
    stopping = true
    stopCreated()
    for (const cleanup of [...attached.values()]) cleanup()
    attached.clear()
    if (inspectionInFlight) await inspectionInFlight.catch(() => {})
  }
}

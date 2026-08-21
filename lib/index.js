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

import z from 'schemastery'
import { createRunner, resolveConfig } from 'dsh-mnemon'
import { DEFAULT_MAX_AGE_DAYS, DEFAULT_THRESHOLD, validatePolicy } from './engine.js'
import { runInspection, runPurge } from './orchestrator.js'
import { SETTINGS_CHANNEL, createSettingsRpcHandler } from './settings-rpc.js'
import { FRESHNESS_CHANNEL, createFreshnessRpcHandler } from './freshness-rpc.js'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export const name = 'dsh-mnemon-gc'
export const inject = ['tools', 'commands', 'agents', 'settings']

export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_MS = 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 插件配置 schema（schemastery）。host 侧用它注册 settings namespace，
 * 使配置进入 ~/.dsh/settings.yaml 的 dsh-mnemon-gc 段、可热更新、可持久化。
 * 字段与 normalizeConfig 一一对应，默认值保持一致。
 */
export const Config = z.object({
  threshold: z.number().min(0).default(DEFAULT_THRESHOLD),
  maxAgeDays: z.number().step(1).min(0).default(DEFAULT_MAX_AGE_DAYS),
  intervalMs: z.number().step(1).min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS).default(DEFAULT_INTERVAL_MS),
  limit: z.number().step(1).min(1).max(1000).default(500),
  cliPath: z.string(),
  dataDir: z.string(),
})

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
 * @param ctx 宿主 Context（tools/commands/agents/settings 由 inject 提供）
 * @param config 插件配置（来自 cordis.patch.yml，作为 settings 的 base 层）
 */
export function apply(ctx, config = {}) {
  // 注册 settings namespace：配置进入 settings.yaml 的 dsh-mnemon-gc 段，
  // 可热更新（settings/updated）并持久化。base 层是 cordis.patch.yml 的 config。
  const settingsScope = ctx.settings.register('dsh-mnemon-gc', Config, {
    base: config,
    applies: 'live',
  })

  // 可变运行时状态：settings 值 → normalizeConfig → runner/policy。
  // 热更新时重建 runner/policy，但保留巡检时间戳与监听器。
  let state = {
    ...normalizeConfig(settingsScope.get()),
    runner: null,
    policy: null,
  }
  const rebuild = () => {
    const normalized = normalizeConfig(settingsScope.get())
    state = { ...normalized, runner: resolveRunner(normalized), policy: { threshold: normalized.threshold, maxAgeDays: normalized.maxAgeDays } }
  }
  rebuild()

  // 进程内状态：上次巡检时间戳 + 进行中的巡检（串行化，避免并发/TOCTOU）。
  let lastInspectionAt = 0
  let inspectionInFlight = null
  let stopping = false

  const stopSettingsWatch = ctx.on('settings/updated', (namespace) => {
    if (namespace !== 'dsh-mnemon-gc') return
    rebuild()
    lastInspectionAt = 0 // 配置变更后允许立即重新巡检
  })

  /** 后台自动巡检：**只报告**，绝不删除。失败仅记日志。 */
  async function autoInspect() {
    if (stopping || inspectionInFlight) return
    const run = (async () => {
      try {
        const report = await runInspection(state.runner, state.policy, { store: 'default', limit: state.limit })
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
        if (now - lastInspectionAt >= state.intervalMs) {
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
      return runInspection(state.runner, state.policy, { store, limit: state.limit })
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
      return runPurge(state.runner, state.policy, { store, limit: state.limit })
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
          const report = await runInspection(state.runner, state.policy, { store, limit: state.limit })
          return { kind: 'success', text: JSON.stringify(report, null, 2) }
        }
        if (op === 'purge') {
          const report = await runPurge(state.runner, state.policy, { store, limit: state.limit })
          return { kind: 'success', text: JSON.stringify(report, null, 2) }
        }
        return { kind: 'error', text: 'usage: /mnemon-gc [inspect|purge] [store]' }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // Web 连接可用时注册 settings RPC 通道（client 侧设置卡片读写的桥梁）。
  let disposeSettingsRpc = () => {}
  let disposeFreshnessRpc = () => {}
  ctx.inject(['connection'], (webContext) => {
    if (webContext.connection === undefined) return
    const settingsHandler = createSettingsRpcHandler(ctx.settings)
    const settingsDispose = webContext.connection.rpc.handle(SETTINGS_CHANNEL, settingsHandler, { authority: 'loopback' })
    if (typeof settingsDispose === 'function') disposeSettingsRpc = settingsDispose

    // 新鲜度视图：只读列表 + 单条精确软删（绕过 gc 分级）。
    // db 路径取 dsh-mnemon 的有效 dataDir 下 data/default/mnemon.db；
    // 每次 openDb 独立连接，handler 内用完即 close。
    const freshnessHandler = createFreshnessRpcHandler({
      openDb: () => new DatabaseSync(join(state.runner.effectiveDataDir(), 'data', 'default', 'mnemon.db'), { readOnly: false }),
    })
    const freshnessDispose = webContext.connection.rpc.handle(FRESHNESS_CHANNEL, freshnessHandler, { authority: 'loopback' })
    if (typeof freshnessDispose === 'function') disposeFreshnessRpc = freshnessDispose
  })

  // 清理：停止自动巡检，移除 settings watch + 全局监听 + settings RPC，并让每个 agent 的 effect 自行清理。
  return async () => {
    stopping = true
    stopSettingsWatch()
    stopCreated()
    disposeSettingsRpc()
    disposeFreshnessRpc()
    for (const cleanup of [...attached.values()]) cleanup()
    attached.clear()
    if (inspectionInFlight) await inspectionInFlight.catch(() => {})
  }
}

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
import { collectSupersededIds, filterSupersededOnly } from './superseded.js'
import { createStoreRegistry, enumerateActiveStores } from './stores.js'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export const name = 'dsh-mnemon-gc'
export const inject = ['tools', 'commands', 'agents', 'settings', 'subagents']

export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_MS = 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 插件配置 schema（schemastery）。host 侧用它注册 settings namespace，
 * 使配置进入 ~/.dsh/settings.yaml 的 dsh-mnemon-gc 段、可热更新、可持久化。
 * 字段与 normalizeConfig 一一对应，默认值保持一致。
 */
export const DEFAULT_DETECT_MAX_TOKENS = 8192
const MIN_DETECT_MAX_TOKENS = 1024
const MAX_DETECT_MAX_TOKENS = 65536

export const Config = z.object({
  threshold: z.number().min(0).default(DEFAULT_THRESHOLD),
  maxAgeDays: z.number().step(1).min(0).default(DEFAULT_MAX_AGE_DAYS),
  intervalMs: z.number().step(1).min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS).default(DEFAULT_INTERVAL_MS),
  limit: z.number().step(1).min(1).max(1000).default(500),
  detectMaxTokens: z.number().step(1).min(MIN_DETECT_MAX_TOKENS).max(MAX_DETECT_MAX_TOKENS).default(DEFAULT_DETECT_MAX_TOKENS),
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
  const detectMaxTokens = raw.detectMaxTokens === undefined ? DEFAULT_DETECT_MAX_TOKENS : Number(raw.detectMaxTokens)
  const cliPath = raw.cliPath === undefined || raw.cliPath === '' ? undefined : String(raw.cliPath)
  const dataDir = raw.dataDir === undefined || raw.dataDir === '' ? undefined : String(raw.dataDir)

  const policy = validatePolicy({ threshold, maxAgeDays })
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new TypeError(`intervalMs must be within [${MIN_INTERVAL_MS}, ${MAX_INTERVAL_MS}], got ${String(intervalMs)}`)
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new TypeError(`limit must be an integer within [1, 1000], got ${String(limit)}`)
  }
  if (!Number.isInteger(detectMaxTokens) || detectMaxTokens < MIN_DETECT_MAX_TOKENS || detectMaxTokens > MAX_DETECT_MAX_TOKENS) {
    throw new TypeError(`detectMaxTokens must be an integer within [${MIN_DETECT_MAX_TOKENS}, ${MAX_DETECT_MAX_TOKENS}], got ${String(detectMaxTokens)}`)
  }
  return { ...policy, intervalMs, limit, detectMaxTokens, cliPath, dataDir }
}

/** 从 dsh-mnemon 解析 resolved config；cliPath/dataDir 仅在显式配置时覆盖。
 *  注意：dsh-mnemon 的 createRunner 仅在 storageScope==='custom' 时使用 dataDir；
 *  因此显式 dataDir 必须配 custom scope，否则会静默回退到 ~/.mnemon。 */
export function buildResolvedConfig(config) {
  const storageScope = config.dataDir ? 'custom' : 'global'
  return resolveConfig({
    storageScope,
    ...(config.cliPath ? { cliPath: config.cliPath } : {}),
    ...(config.dataDir ? { dataDir: config.dataDir } : {}),
  })
}

/** 从 dsh-mnemon 解析 runner。 */
export function resolveRunner(config) {
  return createRunner(buildResolvedConfig(config))
}

/** 把巡检报告压成一行可读文本（logger 输出，不打扰会话）。 */
function renderReport(report) {
  const { tiers, totalInsights, candidatesFound, actions } = report
  const line = `[mnemon-gc] ${report.store}: insights=${totalInsights} candidates=${candidatesFound} superseded=${tiers.superseded} watch=${tiers.watch} immune=${tiers.immune}`
  if (tiers.superseded === 0) return line
  const details = (actions ?? [])
    .filter(a => a.tier === 'superseded')
    .map(a => `  - ${a.content.slice(0, 60)}…`)
    .join('\n')
  return `${line}\n疑似被取代的记忆（待人工确认）：\n${details}`
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
    state = {
      ...normalized,
      runner: resolveRunner(normalized),
      resolvedConfig: buildResolvedConfig(normalized),
      policy: { threshold: normalized.threshold, maxAgeDays: normalized.maxAgeDays },
    }
    storeCache = { dir: null, registry: null } // 配置变更 → 失效 store 目录缓存
  }

  // store 目录缓存：按 effectiveDataDir 缓存，避免每次 list 重建 provider graph / 触发注册表 reconcile。
  let storeCache = { dir: null, registry: null }

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

  /** 冲突检测 LLM 调用：用 subagent 判断记忆间新旧覆盖。 */
  async function detectConflicts({ pairs, prompt }) {
    // 选 provider：优先 'spawn'（dsh-mnemon 常用），回退到第一个可用
    const providers = ctx.subagents.list()
    const provider = providers.includes('spawn') ? 'spawn' : providers[0]
    if (provider === undefined) {
      ctx.logger.warn('[mnemon-gc] no subagent provider available; skipping conflict detection')
      return { results: [] }
    }
    const agent = ctx.agents.roots()[0]
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const run = await ctx.subagents.start(provider, {
        label: 'Mnemon conflict detection',
        prompt: [{ type: 'text', text: prompt + '\n\n请直接返回一个 JSON 对象：{"results":[{"olderId":"...","superseded":true|false,"byId":"...","reason":"..."}]}' }],
        parent: agent,
        signal: controller.signal,
        maxDepth: 1,
        toolFilter: { deny: ['mnemon_gc_purge', 'mnemon_gc_inspect'] },
        // 冲突检测成本配置化（对齐上游 #102 的 worker completion token 预算语义）：
        // dense CJK 或大 MEMORY 场景可调高，成本敏感可调低。
        agentOptions: { maxTokens: state.detectMaxTokens },
        persona: '你是记忆治理审计员。只判断旧记忆是否被新记忆取代（新事实覆盖旧事实），不做任何其他事，不调用记忆写入工具。直接输出 JSON 结果。',
      })
      const result = await run.result
      await run.dispose()
      const text = (result.output ?? []).map(part => part?.text ?? '').join('')
      try {
        const parsed = JSON.parse(text.trim().match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        return parsed
      } catch {
        ctx.logger.warn('[mnemon-gc] conflict detection returned non-JSON; skipping')
        return { results: [] }
      }
    } catch (error) {
      ctx.logger.warn('[mnemon-gc] conflict detection failed: ' + (error instanceof Error ? error.message : String(error)))
      return { results: [] }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** 自动巡检的 store 列表：全部 active native store（复用 store 目录枚举，含目录兜底）。 */
  function autoInspectStores() {
    try {
      const { stores } = enumerateActiveStores(state.resolvedConfig, state.runner.effectiveDataDir())
      return stores.map(s => s.storeId)
    } catch (error) {
      ctx.logger.warn('[mnemon-gc] store enumeration failed, falling back to default: ' + (error instanceof Error ? error.message : String(error)))
      return ['default']
    }
  }

  /** 后台自动巡检：**只报告**，绝不删除。逐 active store 巡检，失败仅记日志。 */
  async function autoInspect() {
    if (stopping || inspectionInFlight) return
    const run = (async () => {
      const stores = autoInspectStores()
      for (const store of stores) {
        try {
          const report = await runInspection(state.runner, state.policy, { store, limit: state.limit, detectFn: detectConflicts })
          ctx.logger.info(renderReport(report))
        } catch (error) {
          // 单个 store 失败不中断其余 store 的巡检。
          ctx.logger.warn(`[mnemon-gc] auto inspection failed (store=${store}): ${error instanceof Error ? error.message : String(error)}`)
        }
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
    description: 'Inspect Mnemon memory stores for conflict-driven retention candidates (superseded by newer memories). Read-only; returns immune/superseded/watch tiers. Does not delete anything.',
    parameters: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Mnemon store name; omit for the default store.' },
      },
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args) => {
      const store = args?.store ? String(args.store) : 'default'
      return runInspection(state.runner, state.policy, { store, limit: state.limit, detectFn: detectConflicts })
    },
  })

  // 手动工具：清理 superseded（软删除，显式触发）
  ctx.tools.register({
    name: 'mnemon_gc_purge',
    description: 'Soft-delete Mnemon insights that were detected as superseded by newer memories. Uses mnemon forget (soft delete). Destructive; only call with explicit intent. Never deletes memories merely because they are old or unaccessed.',
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

  // 手动工具：标记 superseded（写入 causal edge，不删除旧记忆）
  ctx.tools.register({
    name: 'mnemon_gc_mark_superseded',
    description: 'Mark a memory as superseded by a newer memory (records a causal edge with superseded metadata). Does not delete the old memory. Requires explicit intent.',
    parameters: {
      type: 'object',
      properties: {
        oldId: { type: 'string', description: 'The memory id that is superseded.' },
        newId: { type: 'string', description: 'The memory id that supersedes it.' },
        reason: { type: 'string', description: 'Short reason for the supersession.' },
      },
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args) => {
      const db = new DatabaseSync(join(state.runner.effectiveDataDir(), 'data', 'default', 'mnemon.db'), { readOnly: false })
      try {
        db.prepare(`INSERT INTO edges (source_id, target_id, edge_type, weight, metadata, created_at)
          VALUES (?, ?, 'causal', 1.0, ?, ?)
          ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET metadata = excluded.metadata`).run(
          String(args?.oldId ?? ''), String(args?.newId ?? ''), JSON.stringify({ superseded: true, ...(args?.reason ? { reason: String(args.reason) } : {}) }), new Date().toISOString(),
        )
        return { oldId: String(args?.oldId ?? ''), marked: true }
      } finally {
        db.close?.()
      }
    },
  })

  // 手动工具：批量删除已标记 superseded（只删已标记的，其余拒绝）
  ctx.tools.register({
    name: 'mnemon_gc_purge_superseded',
    description: 'Batch-delete memories that were already marked superseded. Rejects any id that has no superseded mark. Destructive; requires explicit intent.',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Memory ids to delete (must all be superseded).' },
      },
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: async (args) => {
      const db = new DatabaseSync(join(state.runner.effectiveDataDir(), 'data', 'default', 'mnemon.db'), { readOnly: false })
      try {
        const edges = db.prepare("SELECT source_id, metadata FROM edges WHERE edge_type = 'causal'").all()
        const supersededIds = collectSupersededIds(edges)
        const { allowed, rejected } = filterSupersededOnly((args?.ids ?? []).map(String), supersededIds)
        const deleted = []
        const failed = []
        for (const id of allowed) {
          const result = db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
          if (result.changes > 0) deleted.push(id); else failed.push({ id, error: 'not found or already deleted' })
        }
        return { deleted, failed, rejected }
      } finally {
        db.close?.()
      }
    },
  })

  // 手动命令：/mnemon-gc inspect|conflicts|mark|purge-superseded
  ctx.commands.register({
    name: 'mnemon-gc',
    description: 'Inspect conflicts, mark superseded, or purge superseded Mnemon memories',
    input: { hint: '[inspect|conflicts|mark|purge-superseded] ...' },
    async handler(invocation) {
      const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
      const op = parts[0]
      try {
        if (op === 'inspect') {
          const report = await runInspection(state.runner, state.policy, { store: 'default', limit: state.limit })
          return { kind: 'success', text: JSON.stringify(report, null, 2) }
        }
        if (op === 'conflicts') {
          const report = await runInspection(state.runner, state.policy, { store: 'default', limit: state.limit, detectFn: detectConflicts })
          const superseded = report.actions.filter(a => a.tier === 'superseded')
          return { kind: 'success', text: JSON.stringify({ supersededCount: superseded.length, superseded: superseded.map(a => ({ id: a.id, content: a.content, supersededBy: a.supersededBy, reason: a.supersededReason })) }, null, 2) }
        }
        if (op === 'mark') {
          const [oldId, newId, ...reasonParts] = parts.slice(1)
          if (!oldId || !newId) return { kind: 'error', text: 'usage: /mnemon-gc mark <oldId> <newId> [reason]' }
          const db = new DatabaseSync(join(state.runner.effectiveDataDir(), 'data', 'default', 'mnemon.db'), { readOnly: false })
          try {
            db.prepare(`INSERT INTO edges (source_id, target_id, edge_type, weight, metadata, created_at)
              VALUES (?, ?, 'causal', 1.0, ?, ?)
              ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET metadata = excluded.metadata`).run(
              oldId, newId, JSON.stringify({ superseded: true, ...(reasonParts.length > 0 ? { reason: reasonParts.join(' ') } : {}) }), new Date().toISOString(),
            )
            return { kind: 'success', text: JSON.stringify({ oldId, marked: true }) }
          } finally {
            db.close?.()
          }
        }
        if (op === 'purge-superseded') {
          const ids = parts.slice(1)
          if (ids.length === 0) return { kind: 'error', text: 'usage: /mnemon-gc purge-superseded <id1> <id2> ...' }
          const db = new DatabaseSync(join(state.runner.effectiveDataDir(), 'data', 'default', 'mnemon.db'), { readOnly: false })
          try {
            const edges = db.prepare("SELECT source_id, metadata FROM edges WHERE edge_type = 'causal'").all()
            const supersededIds = collectSupersededIds(edges)
            const { allowed, rejected } = filterSupersededOnly(ids, supersededIds)
            const deleted = []
            const failed = []
            for (const id of allowed) {
              const result = db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
              if (result.changes > 0) deleted.push(id); else failed.push({ id, error: 'not found or already deleted' })
            }
            return { kind: 'success', text: JSON.stringify({ deleted, failed, rejected }, null, 2) }
          } finally {
            db.close?.()
          }
        }
        return { kind: 'error', text: 'usage: /mnemon-gc [inspect|conflicts|mark|purge-superseded] ...' }
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

    // 新鲜度视图：多 store 只读列表 + 单条精确软删（绕过 gc 分级）。
    // storeRegistry 按 effectiveDataDir 缓存 active native store 目录；
    // openDb 经 registry.resolveOrDefault 解析 data/<spaceId>/mnemon.db（白名单校验 +
    // storeDbPath 防穿越重派生，未知/非法回退 default）；每次 openDb 独立连接，用完即 close。
    const getStoreRegistry = () => {
      const dir = state.runner.effectiveDataDir()
      if (storeCache.dir !== dir || storeCache.registry === null) {
        const { stores } = enumerateActiveStores(state.resolvedConfig, dir)
        storeCache = { dir, registry: createStoreRegistry({ effectiveDataDir: dir, stores }) }
      }
      return storeCache.registry
    }
    const freshnessHandler = createFreshnessRpcHandler({
      listStores: () => getStoreRegistry().list(),
      openDb: (storeId) => {
        const entry = getStoreRegistry().resolveOrDefault(storeId)
        if (entry === null) throw new Error('no active mnemon store available')
        return new DatabaseSync(entry.dbPath, { readOnly: false })
      },
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

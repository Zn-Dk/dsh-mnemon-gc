/**
 * dsh-mnemon-gc 编排层：把 runner、引擎分级、forget 编排成一次巡检/清理。
 * runner 形状对齐 dsh-mnemon 的 MnemonRunner（runJson + effectiveDataDir）。
 *
 * 错误契约：
 *   - runInspection：失败时 throw（调用方决定是日志、工具报错还是命令 error）。
 *   - runPurge：巡检失败 throw；单个 forget 失败只计数 purgeFailed，不中断整体。
 *     同一次调用内先巡检后 forget，候选集一致（避免跨调用 TOCTOU）。
 */

import { classifyCandidate, summarizeTiers } from './engine.js'
import { parseGcOutput } from './cli-adapter.js'

/** 构造一次 mnemon gc 的只读调用参数（子命令在前，--store 在后）。 */
export function buildGcArgs(policy, store, limit = 500) {
  const args = ['gc', '--readonly', '--threshold', String(policy.threshold), '--limit', String(limit)]
  if (store !== 'default') args.push('--store', store)
  return args
}

/** 构造一次 mnemon forget 调用参数（子命令在前，--store 在后）。 */
export function buildForgetArgs(id, store) {
  const args = ['forget', id]
  if (store !== 'default') args.push('--store', store)
  return args
}

/** 扫描一个 store 的所有候选并分级。只读；失败抛错。 */
export async function runInspection(runner, policy, { store = 'default', limit = 500 } = {}) {
  const payload = await runner.runJson(buildGcArgs(policy, store, limit))
  const parsed = parseGcOutput(payload)
  const actions = parsed.candidates.map(candidate => classifyCandidate(candidate, policy))
  return {
    store,
    totalInsights: parsed.totalInsights,
    candidatesFound: parsed.candidatesFound,
    actions,
    tiers: summarizeTiers(actions),
  }
}

/** 扫描并对 stale 候选软删除（mnemon forget）。巡检失败抛错；单个 forget 失败计数。 */
export async function runPurge(runner, policy, { store = 'default', limit = 500 } = {}) {
  const inspection = await runInspection(runner, policy, { store, limit })
  let purged = 0
  let purgeFailed = 0
  const purgeLog = []
  for (const action of inspection.actions) {
    if (action.tier !== 'stale') continue
    try {
      await runner.runJson(buildForgetArgs(action.id, store))
      purged += 1
      purgeLog.push({ id: action.id, ok: true, effectiveImportance: action.effectiveImportance, daysSinceAccess: action.daysSinceAccess })
    } catch (error) {
      purgeFailed += 1
      purgeLog.push({ id: action.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ...inspection, purged, purgeFailed, purgeLog }
}

/**
 * dsh-mnemon-gc 编排层：把 runner、冲突驱动分级、显式删除编排成巡检/清理。
 * runner 形状对齐 dsh-mnemon 的 MnemonRunner（runJson + effectiveDataDir）。
 *
 * 0.2.0 语义（add-conflict-detection 提案）：
 *   - runInspection：读 gc 候选，分级走冲突驱动引擎（superseded/watch/immune）。
 *     「久未访问」不再触发 superseded——只有冲突检测命中才可能被清理。
 *   - runPurge：只删除 tier === 'superseded' 的候选；watch/immune 绝不触碰。
 *     错误契约同前：巡检失败 throw；单个 forget 失败仅计数。
 */

import { classifyCandidates, summarizeTiers } from './engine.js'
import { parseGcOutput } from './cli-adapter.js'
import { screenPairs, buildDetectionPrompt, parseDetectionResults } from './conflict-detector.js'

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

/** 扫描一个 store 的所有候选并按冲突驱动语义分级。只读；失败抛错。
 *  `options.detectFn` 可选注入冲突检测（LLM）：({ pairs }) => Promise<structured>。
 *  检测结果把 conflictDetected 填进候选后再分级。
 */
export async function runInspection(runner, policy, { store = 'default', limit = 500, detectFn } = {}) {
  const payload = await runner.runJson(buildGcArgs(policy, store, limit))
  const parsed = parseGcOutput(payload)
  let candidates = parsed.candidates

  // 冲突检测：若注入了 detectFn 且有可配对候选，先检测再分级
  if (detectFn) {
    const pairs = screenPairs(candidates, policy)
    if (pairs.length > 0) {
      const prompt = buildDetectionPrompt(pairs)
      const structured = await detectFn({ pairs, prompt })
      const results = parseDetectionResults(structured, pairs)
      const byId = new Map(results.map(r => [r.olderId, r]))
      candidates = candidates.map(c => {
        const hit = byId.get(c.id)
        return hit?.superseded ? { ...c, conflictDetected: true, supersededBy: hit.byId, supersededReason: hit.reason } : c
      })
    }
  }

  const actions = classifyCandidates(candidates, policy)
  return {
    store,
    totalInsights: parsed.totalInsights,
    candidatesFound: parsed.candidatesFound,
    actions,
    tiers: summarizeTiers(actions),
  }
}

/** 删除 superseded 候选（仅限冲突检测命中且非免疫）。巡检失败抛错；单个 forget 失败计数。
 *  `options.detectFn` 透传给 runInspection（同一检测结果驱动分级与删除）。 */
export async function runPurge(runner, policy, { store = 'default', limit = 500, detectFn } = {}) {
  const inspection = await runInspection(runner, policy, { store, limit, detectFn })
  let purged = 0
  let purgeFailed = 0
  const purgeLog = []
  for (const action of inspection.actions) {
    if (action.tier !== 'superseded') continue
    try {
      await runner.runJson(buildForgetArgs(action.id, store))
      purged += 1
      purgeLog.push({ id: action.id, ok: true })
    } catch (error) {
      purgeFailed += 1
      purgeLog.push({ id: action.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ...inspection, purged, purgeFailed, purgeLog }
}

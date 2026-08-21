/**
 * dsh-mnemon-gc 纯逻辑层：冲突驱动的记忆治理分级。
 * 无 IO、无宿主依赖，可独立单测。
 *
 * 语义（0.2.0 起，经 add-conflict-detection 提案确认）：
 *   tier 由「冲突检测结果」驱动，不再是时间衰减：
 *     superseded  = 冲突检测命中（conflictDetected === true）且非免疫
 *     immune      = importance >= 4 或 access_count >= 3（或 mnemon 已标记 immune）
 *     watch       = 其余全部（只观察，供人工审阅，绝不自动删除）
 *   新鲜度字段（daysSinceAccess / effectiveImportance）绝不参与 tier 判定。
 *
 * 注意：stale 一词从 0.2.0 起废弃；旧 runPurge（删 stale）语义一并废弃。
 */

export const DEFAULT_THRESHOLD = 0.5
export const DEFAULT_MAX_AGE_DAYS = 30

/** 判定一条记忆是否免疫（高重要度或高频引用）。 */
export function isImmune(candidate) {
  return candidate.immune === true || candidate.importance >= 4 || candidate.accessCount >= 3
}

/** 对单条候选做冲突驱动的分级。 */
export function classifyCandidate(candidate, _policy) {
  // 免疫线优先：高重要度/高频引用即使判冲突也只标免疫，由上层人工处理
  if (isImmune(candidate)) return { ...candidate, tier: 'immune' }

  // 冲突检测命中 → superseded 候选（待人工确认后标记/删除）
  if (candidate.conflictDetected === true) return { ...candidate, tier: 'superseded' }

  // 其余：观察项，绝不自动删除
  return { ...candidate, tier: 'watch' }
}

/** 对候选数组逐一分级，保持输入顺序。 */
export function classifyCandidates(candidates, policy) {
  return candidates.map(candidate => classifyCandidate(candidate, policy))
}

/** 校验 gc 治理策略；非法值抛 TypeError。 */
export function validatePolicy(policy) {
  const { threshold, maxAgeDays } = policy
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new TypeError(`threshold must be a non-negative finite number, got ${String(threshold)}`)
  }
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new TypeError(`maxAgeDays must be a non-negative integer, got ${String(maxAgeDays)}`)
  }
  return policy
}

/** 聚合候选计数（新 tier 集合）。 */
export function summarizeTiers(actions) {
  const totals = { immune: 0, superseded: 0, watch: 0 }
  for (const action of actions) {
    if (action.tier === 'immune') totals.immune += 1
    else if (action.tier === 'superseded') totals.superseded += 1
    else if (action.tier === 'watch') totals.watch += 1
  }
  return totals
}

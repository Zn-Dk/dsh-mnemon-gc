/**
 * dsh-mnemon-gc 纯逻辑层：GC 候选分级与策略校验。
 * 无 IO、无宿主依赖，可独立单测。语义与 mnemon 原生引擎对齐：
 *   immune: importance >= 4 OR access_count >= 3
 *   effective_importance = base_weight(imp) * max(1, log(1+access)) * 0.5^(days/30) * (1+0.1*min(edges,5))
 * 本层不重算 effective_importance——它来自 mnemon gc 的 JSON 输出（可信来源）。
 */

export const DEFAULT_THRESHOLD = 0.5
export const DEFAULT_MAX_AGE_DAYS = 30

/** 来自 mnemon gc 输出的单条候选，已归一化。 */
export function classifyCandidate(candidate, policy) {
  const { importance, accessCount, effectiveImportance, daysSinceAccess, immune } = candidate
  const { threshold, maxAgeDays } = policy

  // 免疫线：mnemon 已判定，或本地独立复核（importance >= 4 / access_count >= 3）
  if (immune === true || importance >= 4 || accessCount >= 3) return { ...candidate, tier: 'immune' }

  // 非免疫且低价值且足够陈旧 → stale（可软删除）
  if (effectiveImportance < threshold && daysSinceAccess >= maxAgeDays) return { ...candidate, tier: 'stale' }

  // 其余低价值候选：只观察，不清理
  return { ...candidate, tier: 'watch' }
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

/** 聚合一个 store 的候选计数。 */
export function summarizeTiers(actions) {
  const totals = { immune: 0, stale: 0, watch: 0 }
  for (const action of actions) {
    if (action.tier === 'immune') totals.immune += 1
    else if (action.tier === 'stale') totals.stale += 1
    else if (action.tier === 'watch') totals.watch += 1
  }
  return totals
}

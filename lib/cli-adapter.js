/**
 * dsh-mnemon-gc CLI 适配层：把 mnemon gc 的 JSON 输出解析成引擎候选。
 * 不碰进程/IO——runner 注入在装配层完成，本层只做纯解析。
 * 0.2.0：conflictDetected 默认 false，由冲突检测层填充。
 */

/** 把 mnemon gc 单条候选归一化为引擎候选。 */
export function normalizeCandidate(raw) {
  const insight = raw?.insight ?? {}
  return {
    id: String(insight.id ?? ''),
    content: String(insight.content ?? ''),
    category: String(insight.category ?? ''),
    importance: Number(insight.importance ?? 0),
    accessCount: Number(insight.access_count ?? 0),
    effectiveImportance: Number(raw?.effective_importance ?? 0),
    daysSinceAccess: Number(raw?.days_since_access ?? 0),
    edgeCount: Number(raw?.edge_count ?? 0),
    immune: raw?.immune === true,
    // 冲突检测标志：默认 false；冲突检测层会在候选上覆盖此字段。
    conflictDetected: raw?.conflictDetected === true,
  }
}

/** 把 mnemon gc 顶层 JSON 归一化为报告结构。 */
export function parseGcOutput(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates.map(normalizeCandidate) : []
  return {
    totalInsights: Number(payload?.total_insights ?? 0),
    candidatesFound: Number(payload?.candidates_found ?? candidates.length),
    candidates,
  }
}

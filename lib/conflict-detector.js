/**
 * dsh-mnemon-gc 冲突检测层（纯逻辑，可单测）。
 * 把「记忆间新事实覆盖旧事实」的检测拆成三步：
 *   1. 轻量初筛（rule-based，零 LLM 成本）：同 category 的旧记忆 + 新记忆配对；
 *   2. prompt 构建：把检测对打包成子代理的输入；
 *   3. 结果解析：把子代理 structured 输出解析为 conflict 标记。
 * LLM 调用本身由装配层注入（detectFn），本层只负责纯数据变换。
 */

/** 初筛：返回「待检测对」列表。只配同 category 的旧→新对，且跳过免疫候选。 */
export function screenPairs(allMemories, policy) {
  const pairs = []
  const byCategory = new Map()
  for (const m of allMemories) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, [])
    byCategory.get(m.category).push(m)
  }
  for (const [category, group] of byCategory) {
    // 按创建时间升序：旧在前
    const sorted = [...group].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const older = sorted[i]
        const newer = sorted[j]
        // 免疫候选不参与冲突检测（由上层人工处理）
        if (older.immune === true || older.importance >= 4 || older.accessCount >= 3) continue
        if (newer.immune === true || newer.importance >= 4 || newer.accessCount >= 3) continue
        pairs.push({ category, olderId: older.id, olderContent: older.content, newerId: newer.id, newerContent: newer.content })
      }
    }
  }
  return pairs
}

/** 构建冲突检测子代理的 prompt 文本。 */
export function buildDetectionPrompt(pairs) {
  if (pairs.length === 0) return ''
  const lines = ['你是一个记忆治理审计员。下面是若干对「旧记忆 → 新记忆」的候选对。',
    '请判断每条旧记忆是否被对应的新记忆**取代**（新事实覆盖旧事实：旧记忆不再正确、已过时、或被更新的表述取代）。',
    '判断标准：',
    '- 若旧记忆与新记忆表达同一事实的不同版本（如路径变更、版本升级、规则更新），且新版本应当取代旧版本 → superseded=true',
    '- 若两条记忆是互补的、不冲突的、或分别描述不同事实 → superseded=false',
    '- 「久未访问」不是取代理由；只有内容层面的新旧覆盖才算。',
    '',
    '候选对：']
  for (const p of pairs) {
    lines.push(`- 对 ID=${p.olderId}
    旧: ${p.olderContent}
    新(${p.newerId}): ${p.newerContent}`)
  }
  lines.push('', '请为每一对返回一个结果。不要调用任何工具，不要叙述计划，通过结果工具一次性完成。')
  return lines.join('\n')
}

/** 解析子代理 structured 输出为冲突标记。 */
export function parseDetectionResults(structured, pairs) {
  const results = Array.isArray(structured?.results) ? structured.results : []
  const byOlderId = new Map()
  for (const r of results) {
    if (r && typeof r.olderId === 'string' && r.superseded === true) {
      byOlderId.set(r.olderId, {
        superseded: true,
        byId: typeof r.byId === 'string' ? r.byId : undefined,
        reason: typeof r.reason === 'string' ? r.reason : '',
      })
    }
  }
  return pairs.map(p => ({
    olderId: p.olderId,
    superseded: byOlderId.has(p.olderId),
    byId: byOlderId.get(p.olderId)?.byId,
    reason: byOlderId.get(p.olderId)?.reason ?? '',
  }))
}

/**
 * dsh-mnemon-gc superseded 标记层（纯逻辑，可单测）。
 * superseded 存储方案：mnemon causal edge（old → new），
 *   --weight 1.0，--meta {"superseded":true,"reason":"..."}。
 * 旧记忆不软删、不改内容，只加一条「被取代」边——保留可追溯。
 * 批量删除只允许删「已有 superseded 边」的记忆（按 superseded 边的 source_id 集合）。
 */

/** 构造 mark-superseded 的 mnemon link CLI 参数。 */
export function buildMarkSupersededArgs(oldId, newId, reason) {
  const meta = { superseded: true, ...(reason ? { reason } : {}) }
  return ['link', oldId, newId, '--type', 'causal', '--weight', '1.0', '--meta', JSON.stringify(meta)]
}

/** 从 superseded 边元数据解析「是否被取代」。 */
export function parseSupersededMeta(metaRaw) {
  if (!metaRaw) return null
  try {
    const parsed = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw
    if (parsed && parsed.superseded === true) return { superseded: true, reason: parsed.reason ?? '' }
  } catch { /* 忽略损坏的 meta */ }
  return null
}

/** 从 edge 行集合里提取「已被取代」的旧记忆 id 集合。
 *  兼容 mnemon.db 真实列名 metadata 与适配层别名 meta。 */
export function collectSupersededIds(edgeRows) {
  const ids = new Set()
  for (const row of edgeRows) {
    const raw = row?.metadata ?? row?.meta
    const meta = parseSupersededMeta(raw)
    if (meta !== null) ids.add(String(row.source_id ?? ''))
  }
  return ids
}

/** 校验批量删除请求：只允许删除 ids 全在 superseded 集合内的记忆。 */
export function filterSupersededOnly(ids, supersededIds) {
  return {
    allowed: ids.filter(id => supersededIds.has(id)),
    rejected: ids.filter(id => !supersededIds.has(id)),
  }
}

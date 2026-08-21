/**
 * dsh-mnemon-gc 记忆新鲜度 provider（纯逻辑，可单测）。
 * 数据源：直接只读 mnemon.db（node:sqlite DatabaseSync），
 * 因为 dsh-mnemon 的 MnemonService.list() 不返回 access_count /
 * last_accessed_at / effective_importance 等新鲜度字段。
 *
 * 注意：本模块不引入任何外部原生依赖，只用 Node 22 内置的 node:sqlite。
 * 因此 tgz 打包时无需额外 install，宿主运行时可用。
 */

/** 一条记忆的新鲜度视图行。 */
export function normalizeFreshnessRow(row) {
  return {
    id: String(row.id ?? ''),
    content: String(row.content ?? ''),
    importance: Number(row.importance ?? 0),
    accessCount: Number(row.access_count ?? 0),
    createdAt: String(row.created_at ?? ''),
    lastAccessedAt: String(row.last_accessed_at ?? ''),
    effectiveImportance: Number(row.effective_importance ?? 0),
  }
}

/** 从 mnemon.db 读全量（未删除）记忆的新鲜度列表，按指定列排序。 */
export function listFreshness(db, { orderBy = 'effective_importance', direction = 'asc' } = {}) {
  const ALLOWED_ORDER = ['effective_importance', 'access_count', 'created_at', 'last_accessed_at', 'importance']
  if (!ALLOWED_ORDER.includes(orderBy)) {
    throw new TypeError(`orderBy must be one of ${ALLOWED_ORDER.join(', ')}, got ${String(orderBy)}`)
  }
  if (direction !== 'asc' && direction !== 'desc') {
    throw new TypeError(`direction must be asc or desc, got ${String(direction)}`)
  }
  const rows = db.prepare(
    `SELECT id, content, importance, access_count, created_at, last_accessed_at, effective_importance
     FROM insights WHERE deleted_at IS NULL ORDER BY ${orderBy} ${direction}`
  ).all()
  return rows.map(normalizeFreshnessRow)
}

/** 按 id 精确软删除单条记忆（不经过任何 gc 分级，直接 forget）。 */
export function forgetById(db, id) {
  const result = db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    new Date().toISOString(),
    String(id),
  )
  return { ok: result.changes > 0, id: String(id) }
}

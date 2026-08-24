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

/** 从 mnemon.db 读全量（未删除）记忆的新鲜度行（不排序）。
 *  每条附带 superseded 状态（是否有 causal edge 标记其被取代）。
 *  多 store 合并时用本函数逐库读取，排序统一放到合并层。 */
export function readFreshness(db) {
  const rows = db.prepare(
    `SELECT id, content, importance, access_count, created_at, last_accessed_at, effective_importance
     FROM insights WHERE deleted_at IS NULL`
  ).all()
  // superseded 边：source_id 为被取代者
  const supersededBy = new Map()
  try {
    const edges = db.prepare("SELECT source_id, target_id, metadata FROM edges WHERE edge_type = 'causal'").all()
    for (const e of edges) {
      try {
        const meta = JSON.parse(e.metadata ?? '{}')
        if (meta.superseded === true) supersededBy.set(String(e.source_id), { byId: String(e.target_id ?? ''), reason: meta.reason ?? '' })
      } catch { /* 忽略损坏 meta */ }
    }
  } catch { /* edges 表可能不存在（旧库） */ }
  return rows.map(row => {
    const base = normalizeFreshnessRow(row)
    const mark = supersededBy.get(base.id)
    if (mark) return { ...base, superseded: true, protected: false, status: 'superseded', supersededBy: mark.byId, supersededReason: mark.reason }
    const protectedItem = base.importance >= 4 || base.accessCount >= 3
    return { ...base, superseded: false, protected: protectedItem, status: protectedItem ? 'protected' : 'normal' }
  })
}

const ALLOWED_ORDER = ['effective_importance', 'access_count', 'created_at', 'last_accessed_at', 'importance', 'state']
const NUMERIC_ORDER = new Set(['effective_importance', 'access_count', 'importance'])

/** orderBy（db 列名）→ item 字段映射。 */
function orderField(orderBy) {
  switch (orderBy) {
    case 'effective_importance': return { field: 'effectiveImportance', numeric: true }
    case 'access_count': return { field: 'accessCount', numeric: true }
    case 'importance': return { field: 'importance', numeric: true }
    case 'created_at': return { field: 'createdAt', numeric: false }
    case 'last_accessed_at': return { field: 'lastAccessedAt', numeric: false }
    default: return { field: null, numeric: false }
  }
}

/** 对新鲜度行数组排序（合并层统一排序；返回新数组，不改原数组）。 */
export function sortFreshness(items, { orderBy = 'effective_importance', direction = 'asc' } = {}) {
  if (!ALLOWED_ORDER.includes(orderBy)) {
    throw new TypeError(`orderBy must be one of ${ALLOWED_ORDER.join(', ')}, got ${String(orderBy)}`)
  }
  if (direction !== 'asc' && direction !== 'desc') {
    throw new TypeError(`direction must be asc or desc, got ${String(direction)}`)
  }
  const dir = direction === 'asc' ? 1 : -1
  const out = [...items]
  if (orderBy === 'state') {
    const rank = { superseded: 0, normal: 1, protected: 2 }
    out.sort((a, b) => dir * (rank[a.status] - rank[b.status]))
    return out
  }
  const { field, numeric } = orderField(orderBy)
  out.sort((a, b) => {
    const cmp = numeric
      ? Number(a[field]) - Number(b[field])
      : String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
    return dir * cmp
  })
  return out
}

/** 从 mnemon.db 读全量并排序（单库便捷入口，向后兼容）。 */
export function listFreshness(db, { orderBy = 'effective_importance', direction = 'asc' } = {}) {
  return sortFreshness(readFreshness(db), { orderBy, direction })
}

/** 按 id 精确软删除单条记忆（不经过任何 gc 分级，直接 forget）。 */
export function forgetById(db, id) {
  const result = db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    new Date().toISOString(),
    String(id),
  )
  return { ok: result.changes > 0, id: String(id) }
}

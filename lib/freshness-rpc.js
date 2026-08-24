/**
 * dsh-mnemon-gc 新鲜度 RPC handler（纯逻辑，可单测）。
 * 暴露多 store 记忆新鲜度列表（只读）、单条精确软删除、标记/批量删除 superseded。
 * 数据源由调用方注入 listStores（active store 目录）与 openDb（按 storeId 打开对应 db）。
 */
import { readFreshness, sortFreshness, forgetById } from './freshness.js'
import { collectSupersededIds, filterSupersededOnly } from './superseded.js'
import { selectStores } from './stores.js'

export const FRESHNESS_CHANNEL = '/dsh-mnemon-gc-freshness'

export function createFreshnessRpcHandler({ listStores, openDb, forget = forgetById }) {
  const getCatalog = () => {
    const raw = typeof listStores === 'function' ? listStores() : []
    return Array.isArray(raw) ? raw : []
  }

  return async (endpoint, rawPayload) => {
    try {
      if (endpoint === 'stores') {
        return {
          ok: true,
          value: { stores: getCatalog().map(s => ({ storeId: s.storeId, storeName: s.storeName })) },
        }
      }

      if (endpoint === 'list') {
        const payload = rawPayload ?? {}
        const orderBy = payload.orderBy ?? 'effective_importance'
        const direction = payload.direction ?? 'asc'
        const catalog = getCatalog()
        const stores = selectStores(catalog, payload.stores)
        const merged = []
        for (const store of stores) {
          const db = openDb(store.storeId)
          try {
            for (const item of readFreshness(db)) {
              merged.push({ ...item, storeId: store.storeId, storeName: store.storeName })
            }
          } finally {
            db.close?.()
          }
        }
        const items = sortFreshness(merged, { orderBy, direction })
        return {
          ok: true,
          value: {
            items,
            stores: stores.map(s => ({ storeId: s.storeId, storeName: s.storeName })),
            total: items.length,
            generatedAt: new Date().toISOString(),
          },
        }
      }

      if (endpoint === 'mark-superseded') {
        const payload = rawPayload ?? {}
        if (typeof payload.oldId !== 'string' || payload.oldId === '' || typeof payload.newId !== 'string' || payload.newId === '') {
          return { ok: false, error: { code: 'bad-request', message: 'oldId and newId are required' } }
        }
        const db = openDb(payload.store)
        try {
          const reason = typeof payload.reason === 'string' ? payload.reason : ''
          // 插入 causal edge（source=old, target=new），metadata 记 superseded
          db.prepare(`INSERT INTO edges (source_id, target_id, edge_type, weight, metadata, created_at)
            VALUES (?, ?, 'causal', 1.0, ?, ?)
            ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET metadata = excluded.metadata`).run(
            payload.oldId, payload.newId, JSON.stringify({ superseded: true, ...(reason ? { reason } : {}) }), new Date().toISOString(),
          )
          return { ok: true, value: { oldId: payload.oldId, marked: true } }
        } finally {
          db.close?.()
        }
      }

      if (endpoint === 'purge-superseded') {
        const payload = rawPayload ?? {}
        if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
          return { ok: false, error: { code: 'bad-request', message: 'ids must be a non-empty array' } }
        }
        const db = openDb(payload.store)
        try {
          // 读当前 superseded 边，只允许删已标记的
          const edges = db.prepare("SELECT source_id, metadata FROM edges WHERE edge_type = 'causal'").all()
          const supersededIds = collectSupersededIds(edges)
          const { allowed, rejected } = filterSupersededOnly(payload.ids.map(String), supersededIds)
          const deleted = []
          const failed = []
          for (const id of allowed) {
            try {
              const result = db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
              if (result.changes > 0) deleted.push(id); else failed.push({ id, error: 'not found or already deleted' })
            } catch (e) {
              failed.push({ id, error: e instanceof Error ? e.message : String(e) })
            }
          }
          return { ok: true, value: { deleted, failed, rejected } }
        } finally {
          db.close?.()
        }
      }

      if (endpoint === 'forget') {
        const payload = rawPayload ?? {}
        if (typeof payload.id !== 'string' || payload.id === '') {
          return { ok: false, error: { code: 'bad-request', message: 'id is required' } }
        }
        const db = openDb(payload.store)
        try {
          const result = forget(db, payload.id)
          return { ok: true, value: result }
        } finally {
          db.close?.()
        }
      }

      return { ok: false, error: { code: 'bad-request', message: `unknown freshness endpoint: ${endpoint}` } }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

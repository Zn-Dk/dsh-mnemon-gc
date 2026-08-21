/**
 * dsh-mnemon-gc 新鲜度 RPC handler（纯逻辑，可单测）。
 * 暴露记忆新鲜度列表（只读）与单条精确软删除（绕过 gc 分级）。
 * 数据源由调用方注入一个 db 工厂（避免 handler 直接依赖文件路径）。
 */
import { listFreshness, forgetById } from './freshness.js'

export const FRESHNESS_CHANNEL = '/dsh-mnemon-gc-freshness'

export function createFreshnessRpcHandler({ openDb, forget = forgetById }) {
  return async (endpoint, rawPayload) => {
    try {
      if (endpoint === 'list') {
        const payload = rawPayload ?? {}
        const orderBy = payload.orderBy ?? 'effective_importance'
        const direction = payload.direction ?? 'asc'
        const db = openDb()
        try {
          const items = listFreshness(db, { orderBy, direction })
          return { ok: true, value: { items, total: items.length, generatedAt: new Date().toISOString() } }
        } finally {
          db.close?.()
        }
      }
      if (endpoint === 'forget') {
        const payload = rawPayload ?? {}
        if (typeof payload.id !== 'string' || payload.id === '') {
          return { ok: false, error: { code: 'bad-request', message: 'id is required' } }
        }
        const db = openDb()
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

/**
 * dsh-mnemon-gc store 目录与路由（纯逻辑 + 枚举，可单测）。
 *
 * - 白名单校验 + 防穿越路径解析：store id 只允许 /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/，
 *   不含路径分隔符（/、\）、..、绝对路径段；db 路径统一由 effectiveDataDir
 *   + 单个校验过的 spaceId 文件名 join 得到。
 * - active store 枚举：优先复用 dsh-mnemon 公共 API
 *   （createRuntimeGraph → service.bodyDirectory，取 mnemon-native 且 active 的 body，
 *   含 store id → name 显示映射：default→default、uuid→如 o3-web）；
 *   API 不可用或返回空时回退 <effectiveDataDir>/data/<spaceId>/mnemon.db 目录枚举。
 */

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRuntimeGraph } from 'dsh-mnemon'

export const STORE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
export const DEFAULT_STORE_ID = 'default'

/** 校验并归一化 store id；非法返回 null。 */
export function normalizeStoreId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!STORE_ID_PATTERN.test(id)) return null
  return id
}

/** 由 effectiveDataDir + 已校验 storeId 解析 mnemon.db 绝对路径（防穿越）。
 *  id 通过白名单正则（无 /、\、..、绝对路径段），join 单个文件名安全；非法返回 null。 */
export function storeDbPath(effectiveDataDir, storeId) {
  const id = normalizeStoreId(storeId)
  if (id === null) return null
  return join(effectiveDataDir, 'data', id, 'mnemon.db')
}

/** 确定性排序：default 最前，其余按 storeId 升序。 */
export function sortStores(stores) {
  return [...stores].sort((a, b) => {
    if (a.storeId === DEFAULT_STORE_ID && b.storeId !== DEFAULT_STORE_ID) return -1
    if (b.storeId === DEFAULT_STORE_ID && a.storeId !== DEFAULT_STORE_ID) return 1
    if (a.storeId < b.storeId) return -1
    if (a.storeId > b.storeId) return 1
    return 0
  })
}

/** 把请求的 store 选择解析为 catalog 子集（去重、保序、丢弃未知/非法）。
 *  requested 为 undefined/null/[]，或筛选后为空 → 全部（默认全选语义）。 */
export function selectStores(catalog, requested) {
  const all = sortStores(catalog ?? [])
  if (requested === undefined || requested === null) return all
  if (!Array.isArray(requested)) return all
  const known = new Map(all.map(s => [s.storeId, s]))
  const seen = new Set()
  const out = []
  for (const raw of requested) {
    const id = normalizeStoreId(raw)
    if (id === null || seen.has(id)) continue
    const entry = known.get(id)
    if (entry === undefined) continue
    seen.add(id)
    out.push(entry)
  }
  return out.length > 0 ? sortStores(out) : all
}

/** 构造 store 注册表：白名单解析 + 防穿越路径重建（统一入口，可单测）。 */
export function createStoreRegistry({ effectiveDataDir, stores }) {
  const catalog = sortStores(stores ?? [])
  const byId = new Map(catalog.map(s => [s.storeId, s]))
  const rebuildPath = (entry) => {
    const dbPath = storeDbPath(effectiveDataDir, entry.storeId)
    return dbPath === null ? null : { ...entry, dbPath }
  }
  const resolve = (storeId) => {
    const id = normalizeStoreId(storeId)
    if (id === null) return null
    const entry = byId.get(id)
    return entry === undefined ? null : rebuildPath(entry)
  }
  const resolveOrDefault = (storeId) => {
    const hit = resolve(storeId)
    if (hit !== null) return hit
    const fallback = byId.get(DEFAULT_STORE_ID)
    return fallback === undefined ? null : rebuildPath(fallback)
  }
  return { list: () => catalog, resolve, resolveOrDefault }
}

/** 把 bodyDirectory() 的 catalog 映射为 store 目录：过滤 mnemon-native active、id 校验、dbPath 统一重派生。 */
export function mapApiCatalogToStores(catalog, effectiveDataDir) {
  return sortStores((catalog?.items ?? [])
    .filter(b => b.provider?.id === 'mnemon-native' && b.active === true)
    .map(b => {
      const storeId = normalizeStoreId(b.id)
      if (storeId === null) return null
      return {
        storeId,
        storeName: String(b.name ?? storeId),
        // 不信任上游 dbPath：统一经 storeDbPath 重派生，与 openDb 同一路径规则
        dbPath: storeDbPath(effectiveDataDir, storeId),
      }
    })
    .filter(s => s !== null))
}

/** 优先用 dsh-mnemon 公共 API 枚举 active native store（id + name 映射）。 */
export function enumerateActiveStoresViaApi(resolvedConfig) {
  const graph = createRuntimeGraph(resolvedConfig)
  const catalog = graph.service.bodyDirectory()
  return { stores: mapApiCatalogToStores(catalog, graph.runner.effectiveDataDir()), source: 'dsh-mnemon memory bodies (createRuntimeGraph → service.bodyDirectory)' }
}

/** 目录枚举兜底：<effectiveDataDir>/data/<spaceId>/mnemon.db。 */
export function enumerateActiveStoresFromDisk(effectiveDataDir) {
  const dataDir = join(effectiveDataDir, 'data')
  const stores = []
  if (existsSync(dataDir)) {
    for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const storeId = normalizeStoreId(entry.name)
      if (storeId === null) continue
      const dbPath = storeDbPath(effectiveDataDir, storeId)
      if (dbPath === null || !existsSync(dbPath)) continue
      stores.push({ storeId, storeName: storeId, dbPath })
    }
  }
  return { stores: sortStores(stores), source: 'directory enumeration (data/<spaceId>/mnemon.db)' }
}

/** 枚举 active store：API 优先，兜底目录枚举。viaApi 可注入以便测试主路径。 */
export function enumerateActiveStores(resolvedConfig, effectiveDataDir, viaApi = enumerateActiveStoresViaApi) {
  try {
    const via = viaApi(resolvedConfig)
    if (via && Array.isArray(via.stores) && via.stores.length > 0) return via
  } catch { /* API 不可用 → 目录枚举 */ }
  const viaDisk = enumerateActiveStoresFromDisk(effectiveDataDir)
  return {
    stores: viaDisk.stores,
    source: `${viaDisk.source} (fallback: dsh-mnemon 公共枚举 API 不可用或返回空)`,
  }
}

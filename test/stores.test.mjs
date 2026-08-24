import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeStoreId,
  storeDbPath,
  sortStores,
  selectStores,
  createStoreRegistry,
  mapApiCatalogToStores,
  enumerateActiveStores,
  enumerateActiveStoresFromDisk,
  DEFAULT_STORE_ID,
} from '../lib/stores.js'

// seam：store 目录/路由纯逻辑（白名单 + 防穿越 + 选择解析 + 目录枚举兜底）。

const catalog = [
  { storeId: 'default', storeName: 'default', dbPath: '/root/.mnemon/data/default/mnemon.db' },
  { storeId: '00278095-1684-4a6f-8cf5-5266ce84a6aa', storeName: 'o3-web', dbPath: '/root/.mnemon/data/00278095-1684-4a6f-8cf5-5266ce84a6aa/mnemon.db' },
]

test('normalizeStoreId 接受合法 id，拒绝非法/穿越 id', () => {
  assert.equal(normalizeStoreId('default'), 'default')
  assert.equal(normalizeStoreId('00278095-1684-4a6f-8cf5-5266ce84a6aa'), '00278095-1684-4a6f-8cf5-5266ce84a6aa')
  assert.equal(normalizeStoreId('  default  '), 'default')
  assert.equal(normalizeStoreId('Alpha_1-2'), 'Alpha_1-2')
  assert.equal(normalizeStoreId('../etc'), null)
  assert.equal(normalizeStoreId('/abs'), null)
  assert.equal(normalizeStoreId('a/b'), null)
  assert.equal(normalizeStoreId('a\\b'), null)
  assert.equal(normalizeStoreId('..'), null)
  assert.equal(normalizeStoreId('.'), null)
  assert.equal(normalizeStoreId(''), null)
  assert.equal(normalizeStoreId(undefined), null)
  assert.equal(normalizeStoreId(123), null)
})

test('storeDbPath 只拼接校验过的单个文件名（防穿越）', () => {
  assert.equal(storeDbPath('/root/.mnemon', 'default'), '/root/.mnemon/data/default/mnemon.db')
  assert.equal(storeDbPath('/root/.mnemon', '../etc'), null)
  assert.equal(storeDbPath('/root/.mnemon', 'a/b'), null)
  assert.equal(storeDbPath('/root/.mnemon', '/abs'), null)
  assert.equal(storeDbPath('/root/.mnemon', 'a\\b'), null)
})

test('sortStores default 优先、其余按 id 升序', () => {
  const sorted = sortStores([
    { storeId: 'zzz', storeName: 'z' },
    { storeId: 'default', storeName: 'default' },
    { storeId: 'aaa', storeName: 'a' },
  ])
  assert.deepEqual(sorted.map(s => s.storeId), ['default', 'aaa', 'zzz'])
})

test('selectStores 缺省/空/全非法 → 全部；有效子集去重保序', () => {
  assert.deepEqual(selectStores(catalog, undefined).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, null).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, []).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, ['default']).map(s => s.storeId), ['default'])
  assert.deepEqual(selectStores(catalog, ['00278095-1684-4a6f-8cf5-5266ce84a6aa']).map(s => s.storeId), ['00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, ['00278095-1684-4a6f-8cf5-5266ce84a6aa', 'default', '00278095-1684-4a6f-8cf5-5266ce84a6aa']).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  // 未知/非法 store 全部被丢弃 → 回退全部
  assert.deepEqual(selectStores(catalog, ['bogus']).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, ['../etc']).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(selectStores(catalog, ['a/b']).map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
})

test('createStoreRegistry 重建 dbPath 并防穿越', () => {
  const registry = createStoreRegistry({ effectiveDataDir: '/root/.mnemon', stores: catalog })
  const hit = registry.resolveOrDefault('00278095-1684-4a6f-8cf5-5266ce84a6aa')
  assert.equal(hit.dbPath, '/root/.mnemon/data/00278095-1684-4a6f-8cf5-5266ce84a6aa/mnemon.db')
  const fallback = registry.resolveOrDefault('../evil')
  assert.equal(fallback.storeId, DEFAULT_STORE_ID)
  assert.equal(fallback.dbPath, '/root/.mnemon/data/default/mnemon.db')
})

test('mapApiCatalogToStores 过滤 mnemon-native active 且 dbPath 统一重派生', () => {
  const catalog = {
    items: [
      { id: 'default', name: 'default', active: true, provider: { id: 'mnemon-native' }, dbPath: '/evil/injected.db' },
      { id: '00278095-1684-4a6f-8cf5-5266ce84a6aa', name: 'o3-web', active: true, provider: { id: 'mnemon-native' }, dbPath: '/evil/other.db' },
      { id: 'inactive', name: 'inactive', active: false, provider: { id: 'mnemon-native' }, dbPath: '/evil/inactive.db' },
      { id: 'openviking-x', name: 'ov', active: true, provider: { id: 'openviking' }, dbPath: '/evil/ov.db' },
      { id: '../evil', name: 'evil', active: true, provider: { id: 'mnemon-native' }, dbPath: '/evil/evil.db' },
    ],
  }
  const stores = mapApiCatalogToStores(catalog, '/root/.mnemon')
  assert.deepEqual(stores.map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.deepEqual(stores.map(s => s.storeName), ['default', 'o3-web'])
  // dbPath 不采信上游注入值，统一经 storeDbPath 重派生
  assert.deepEqual(stores.map(s => s.dbPath), [
    '/root/.mnemon/data/default/mnemon.db',
    '/root/.mnemon/data/00278095-1684-4a6f-8cf5-5266ce84a6aa/mnemon.db',
  ])
})

test('enumerateActiveStores API 返回非空时直接用 API 结果', () => {
  const viaApi = () => ({ stores: [{ storeId: 'default', storeName: 'default', dbPath: '/x' }], source: 'api-source' })
  const result = enumerateActiveStores({}, '/root/.mnemon', viaApi)
  assert.equal(result.source, 'api-source')
  assert.deepEqual(result.stores.map(s => s.storeId), ['default'])
})

test('enumerateActiveStores API 返回空时回退目录枚举', () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'stores-fb-'))
  mkdirSync(join(root, 'data', 'default'), { recursive: true })
  writeFileSync(join(root, 'data', 'default', 'mnemon.db'), '')
  const viaApi = () => ({ stores: [], source: 'api-source' })
  const result = enumerateActiveStores({}, root, viaApi)
  assert.ok(result.source.includes('fallback'))
  assert.deepEqual(result.stores.map(s => s.storeId), ['default'])
})

test('enumerateActiveStores API 抛错时回退目录枚举', () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'stores-fb-'))
  mkdirSync(join(root, 'data', 'default'), { recursive: true })
  writeFileSync(join(root, 'data', 'default', 'mnemon.db'), '')
  const viaApi = () => { throw new Error('api down') }
  const result = enumerateActiveStores({}, root, viaApi)
  assert.ok(result.source.includes('fallback'))
  assert.deepEqual(result.stores.map(s => s.storeId), ['default'])
})

test('enumerateActiveStoresFromDisk 只收合法目录且含 mnemon.db', () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'stores-'))
  const dataDir = join(root, 'data')
  mkdirSync(join(dataDir, 'default'), { recursive: true })
  mkdirSync(join(dataDir, '00278095-1684-4a6f-8cf5-5266ce84a6aa'), { recursive: true })
  mkdirSync(join(dataDir, 'no-db-dir'), { recursive: true }) // 无 mnemon.db，跳过
  mkdirSync(join(dataDir, '..evil'), { recursive: true }) // 非法 id，跳过
  writeFileSync(join(dataDir, 'default', 'mnemon.db'), '')
  writeFileSync(join(dataDir, '00278095-1684-4a6f-8cf5-5266ce84a6aa', 'mnemon.db'), '')

  const result = enumerateActiveStoresFromDisk(root)
  assert.deepEqual(result.stores.map(s => s.storeId), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  // 兜底枚举 name = id（default→default，uuid→uuid）
  assert.deepEqual(result.stores.map(s => s.storeName), ['default', '00278095-1684-4a6f-8cf5-5266ce84a6aa'])
  assert.ok(result.stores.every(s => s.dbPath.endsWith('/mnemon.db')))
})

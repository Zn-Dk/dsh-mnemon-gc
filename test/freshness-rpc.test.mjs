import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createFreshnessRpcHandler, FRESHNESS_CHANNEL } from '../lib/freshness-rpc.js'

// seam：新鲜度 RPC handler 纯逻辑（注入 listStores + openDb 工厂）。

const INSIGHTS_SCHEMA = `CREATE TABLE insights (
  id TEXT PRIMARY KEY, content TEXT NOT NULL, importance INTEGER DEFAULT 3,
  access_count INTEGER DEFAULT 0, created_at TEXT NOT NULL,
  last_accessed_at TEXT, effective_importance REAL DEFAULT 0.5, deleted_at TEXT
)`
const EDGES_SCHEMA = `CREATE TABLE IF NOT EXISTS edges (
  source_id TEXT NOT NULL, target_id TEXT NOT NULL, edge_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, edge_type)
)`

/** 建一个内存 db 并插入若干 insights 行。 */
function makeDb(rows = []) {
  const db = new DatabaseSync(':memory:')
  db.exec(INSIGHTS_SCHEMA)
  db.exec(EDGES_SCHEMA)
  const insert = db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
  for (const r of rows) insert.run(r.id, r.content, r.importance, r.access_count, r.created_at, r.last_accessed_at, r.effective_importance, null)
  return db
}

// 单 store 工厂（向后兼容旧测试）：每次 openDb 返回独立连接（含 a/b 两行）。
function makeDbFactory() {
  const makeDbConn = () => makeDb([
    { id: 'a', content: '记忆A', importance: 3, access_count: 0, created_at: 'c1', last_accessed_at: 'l1', effective_importance: 0.5 },
    { id: 'b', content: '记忆B', importance: 5, access_count: 10, created_at: 'c2', last_accessed_at: 'l2', effective_importance: 5.0 },
  ])
  return {
    openDb: () => makeDbConn(),
    listStores: () => [{ storeId: 'default', storeName: 'default', dbPath: ':memory:' }],
  }
}

// 多 store 工厂：default + uuid(o3-web) 各两行，effective_importance 交错。
function multiStoreHandler() {
  const seed = {
    default: [
      { id: 'd1', content: 'D1', importance: 3, access_count: 0, created_at: 'c1', last_accessed_at: 'l1', effective_importance: 5.0 },
      { id: 'd2', content: 'D2', importance: 3, access_count: 0, created_at: 'c2', last_accessed_at: 'l2', effective_importance: 0.5 },
    ],
    '00278095-1684-4a6f-8cf5-5266ce84a6aa': [
      { id: 'o1', content: 'O1', importance: 3, access_count: 0, created_at: 'c3', last_accessed_at: 'l3', effective_importance: 4.0 },
      { id: 'o2', content: 'O2', importance: 3, access_count: 0, created_at: 'c4', last_accessed_at: 'l4', effective_importance: 2.0 },
    ],
  }
  const listStores = () => [
    { storeId: 'default', storeName: 'default', dbPath: ':memory:' },
    { storeId: '00278095-1684-4a6f-8cf5-5266ce84a6aa', storeName: 'o3-web', dbPath: ':memory:' },
  ]
  // 每次 openDb 返回全新连接（真实语义：每次打开文件 db），避免复用已 close 的连接。
  const openDb = (storeId) => makeDb(seed[storeId] ?? [])
  return createFreshnessRpcHandler({ listStores, openDb })
}

test('list 端点返回记忆列表', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('list', {})
  assert.equal(res.ok, true)
  assert.equal(res.value.total, 2)
  assert.equal(res.value.items.length, 2)
})

test('list 支持排序参数', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('list', { orderBy: 'access_count', direction: 'desc' })
  assert.deepEqual(res.value.items.map(i => i.id), ['b', 'a'])
})

test('list 支持 state 排序并返回 protected 状态', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('list', { orderBy: 'state', direction: 'asc' })
  assert.deepEqual(res.value.items.map(i => i.status), ['normal', 'protected'])
  assert.equal(res.value.items[1].protected, true)
})

test('list 合并多 store 并每行标注 storeId/storeName', async () => {
  const handler = multiStoreHandler()
  const res = await handler('list', {})
  assert.equal(res.ok, true)
  assert.equal(res.value.total, 4)
  assert.deepEqual(res.value.items.map(i => i.id).sort(), ['d1', 'd2', 'o1', 'o2'])
  const byId = new Map(res.value.items.map(i => [i.id, i]))
  assert.equal(byId.get('d1').storeId, 'default')
  assert.equal(byId.get('d1').storeName, 'default')
  assert.equal(byId.get('o1').storeId, '00278095-1684-4a6f-8cf5-5266ce84a6aa')
  assert.equal(byId.get('o1').storeName, 'o3-web')
  // 响应带 store 目录
  assert.deepEqual(res.value.stores, [
    { storeId: 'default', storeName: 'default' },
    { storeId: '00278095-1684-4a6f-8cf5-5266ce84a6aa', storeName: 'o3-web' },
  ])
})

test('list 合并层统一排序（不按库分别排序）', async () => {
  const handler = multiStoreHandler()
  const res = await handler('list', { orderBy: 'effective_importance', direction: 'asc' })
  // 全局排序：0.5(d2) < 2.0(o2) < 4.0(o1) < 5.0(d1)
  assert.deepEqual(res.value.items.map(i => i.id), ['d2', 'o2', 'o1', 'd1'])
})

test('list 支持 stores 筛选单个 store', async () => {
  const handler = multiStoreHandler()
  const res = await handler('list', { stores: ['00278095-1684-4a6f-8cf5-5266ce84a6aa'] })
  assert.equal(res.value.total, 2)
  assert.deepEqual(res.value.items.map(i => i.id).sort(), ['o1', 'o2'])
  assert.ok(res.value.items.every(i => i.storeId === '00278095-1684-4a6f-8cf5-5266ce84a6aa'))
})

test('list 未知/非法 store 回退全部（默认全选）', async () => {
  const handler = multiStoreHandler()
  const bogus = await handler('list', { stores: ['bogus'] })
  assert.equal(bogus.value.total, 4)
  const traversal = await handler('list', { stores: ['../etc'] })
  assert.equal(traversal.value.total, 4)
})

test('stores 端点返回 active store 目录', async () => {
  const handler = multiStoreHandler()
  const res = await handler('stores', {})
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.stores, [
    { storeId: 'default', storeName: 'default' },
    { storeId: '00278095-1684-4a6f-8cf5-5266ce84a6aa', storeName: 'o3-web' },
  ])
})

test('mark/purge/forget 透传 store 参数给 openDb', async () => {
  const opened = []
  const openDb = (storeId) => { opened.push(storeId); return makeDb([]) }
  const handler = createFreshnessRpcHandler({ listStores: () => [], openDb })
  await handler('forget', { id: 'x', store: 'o3-web' })
  await handler('mark-superseded', { oldId: 'a', newId: 'b', store: 'o3-web' })
  await handler('purge-superseded', { ids: ['a'], store: 'o3-web' })
  assert.deepEqual(opened, ['o3-web', 'o3-web', 'o3-web'])
  opened.length = 0
  await handler('forget', { id: 'x' }) // 无 store → undefined（由 openDb 兜底 default）
  assert.deepEqual(opened, [undefined])
})

test('forget 端点按 id 精确软删', async () => {
  // 用临时文件 db 保证 forget 后重开连接能看到删除效果
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'freshness-rpc-'))
  const file = join(dir, 'test.db')
  const seedFile = () => {
    const db = new DatabaseSync(file)
    db.exec(INSIGHTS_SCHEMA)
    const insert = db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
    insert.run('a', '记忆A', 3, 0, 'c1', 'l1', 0.5, null)
    insert.run('b', '记忆B', 5, 10, 'c2', 'l2', 5.0, null)
    return db
  }
  let first = seedFile(); first.close()
  const handler = createFreshnessRpcHandler({ openDb: () => new DatabaseSync(file), listStores: () => [{ storeId: 'default', storeName: 'default', dbPath: file }] })
  const res = await handler('forget', { id: 'a' })
  assert.equal(res.ok, true)
  assert.equal(res.value.ok, true)
  const listRes = await handler('list', {})
  assert.deepEqual(listRes.value.items.map(i => i.id), ['b'])
})

test('forget 拒绝空 id', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('forget', { id: '' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'bad-request')
})

test('mark-superseded 写入 causal edge 并记录取代关系', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('mark-superseded', { oldId: 'a', newId: 'b', reason: '路径已更新' })
  assert.equal(res.ok, true)
  assert.equal(res.value.marked, true)
})

test('mark-superseded 拒绝缺失 oldId/newId', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  assert.equal((await handler('mark-superseded', { oldId: 'a' })).ok, false)
  assert.equal((await handler('mark-superseded', { newId: 'b' })).ok, false)
})

test('purge-superseded 只删已标记 superseded 的记忆', async () => {
  // 用文件 db 保证 mark 与 purge 看到同一个持久化状态
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'freshness-sup-'))
  const file = join(dir, 'test.db')
  const seed = () => {
    const db = new DatabaseSync(file)
    db.exec(INSIGHTS_SCHEMA)
    db.exec(EDGES_SCHEMA)
    const ins = db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
    ins.run('a', 'A', 3, 0, 'c1', 'l1', 0.5, null)
    ins.run('b', 'B', 5, 10, 'c2', 'l2', 5.0, null)
    return db
  }
  let first = seed(); first.close()
  const handler = createFreshnessRpcHandler({ openDb: () => new DatabaseSync(file), listStores: () => [] })
  await handler('mark-superseded', { oldId: 'a', newId: 'b', reason: 'x' })
  const res = await handler('purge-superseded', { ids: ['a', 'b'] })
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.deleted, ['a'])  // a 已标记可删
  assert.deepEqual(res.value.rejected, ['b']) // b 未标记被拒
})

test('purge-superseded 拒绝空 ids', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  assert.equal((await handler('purge-superseded', { ids: [] })).ok, false)
})

test('未知端点返回 bad-request', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('bogus', {})
  assert.equal(res.ok, false)
})

test('FRESHNESS_CHANNEL 常量稳定', () => {
  assert.equal(FRESHNESS_CHANNEL, '/dsh-mnemon-gc-freshness')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createFreshnessRpcHandler, FRESHNESS_CHANNEL } from '../lib/freshness-rpc.js'

// seam：新鲜度 RPC handler 纯逻辑（注入内存 db 工厂）。

function makeDbFactory() {
  // 每次 openDb 返回一个独立连接（真实语义：每次打开文件 db），
  // 这样 handler 的 finally close 是正确且不影响下一次调用。
  const makeDb = () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE insights (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, importance INTEGER DEFAULT 3,
        access_count INTEGER DEFAULT 0, created_at TEXT NOT NULL,
        last_accessed_at TEXT, effective_importance REAL DEFAULT 0.5, deleted_at TEXT
      )
    `)
    db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('a', '记忆A', 3, 0, 'c1', 'l1', 0.5, null)
    db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('b', '记忆B', 5, 10, 'c2', 'l2', 5.0, null)
    return db
  }
  return { openDb: makeDb }
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

test('forget 端点按 id 精确软删', async () => {
  // 用临时文件 db 保证 forget 后重开连接能看到删除效果
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'freshness-rpc-'))
  const file = join(dir, 'test.db')
  const seedFile = () => {
    const db = new DatabaseSync(file)
    db.exec("CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, content TEXT NOT NULL, importance INTEGER DEFAULT 3, access_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, last_accessed_at TEXT, effective_importance REAL DEFAULT 0.5, deleted_at TEXT)")
    const insert = db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
    insert.run('a', '记忆A', 3, 0, 'c1', 'l1', 0.5, null)
    insert.run('b', '记忆B', 5, 10, 'c2', 'l2', 5.0, null)
    return db
  }
  let first = seedFile(); first.close()
  const handler = createFreshnessRpcHandler({ openDb: () => new DatabaseSync(file) })
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

test('未知端点返回 bad-request', async () => {
  const handler = createFreshnessRpcHandler(makeDbFactory())
  const res = await handler('bogus', {})
  assert.equal(res.ok, false)
})

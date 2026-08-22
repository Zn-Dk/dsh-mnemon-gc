import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { listFreshness, forgetById, normalizeFreshnessRow } from '../lib/freshness.js'

// seam：新鲜度 provider 纯逻辑（注入内存 sqlite）。
// 验证列表排序、只列未删除、按 id 精确软删（不经过 gc 分级）。

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE insights (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, importance INTEGER DEFAULT 3,
      access_count INTEGER DEFAULT 0, created_at TEXT NOT NULL,
      last_accessed_at TEXT, effective_importance REAL DEFAULT 0.5, deleted_at TEXT
    )
  `)
  return db
}

function seed(db) {
  const insert = db.prepare('INSERT INTO insights (id, content, importance, access_count, created_at, last_accessed_at, effective_importance, deleted_at) VALUES (?,?,?,?,?,?,?,?)')
  insert.run('a', '记忆A', 3, 0, '2026-08-20', '2026-08-21', 0.5, null)
  insert.run('b', '记忆B', 5, 10, '2026-08-19', '2026-08-21', 5.0, null)
  insert.run('c', '记忆C（已删）', 2, 1, '2026-08-18', '2026-08-20', 0.3, '2026-08-21')
  insert.run('d', '记忆D', 4, 3, '2026-08-17', '2026-08-20', 4.0, null)
}

test('listFreshness 只列未删除记忆', () => {
  const db = makeDb(); seed(db)
  const rows = listFreshness(db)
  assert.equal(rows.length, 3) // c 被排除
  assert.ok(rows.every(r => r.id !== 'c'))
})

test('listFreshness 按 effective_importance 升序默认排序', () => {
  const db = makeDb(); seed(db)
  const rows = listFreshness(db)
  assert.deepEqual(rows.map(r => r.id), ['a', 'd', 'b'])
})

test('listFreshness 支持按 access_count 降序', () => {
  const db = makeDb(); seed(db)
  const rows = listFreshness(db, { orderBy: 'access_count', direction: 'desc' })
  assert.deepEqual(rows.map(r => r.id), ['b', 'd', 'a'])
})

test('normalizeFreshnessRow 字段归一化', () => {
  const row = { id: 1, content: 'x', importance: '3', access_count: '7', created_at: 'c', last_accessed_at: 'l', effective_importance: '2.5' }
  assert.deepEqual(normalizeFreshnessRow(row), {
    id: '1', content: 'x', importance: 3, accessCount: 7, createdAt: 'c', lastAccessedAt: 'l', effectiveImportance: 2.5,
  })
})

test('listFreshness 返回状态并按状态排序', () => {
  const db = makeDb(); seed(db)
  const rows = listFreshness(db, { orderBy: 'state', direction: 'asc' })
  assert.deepEqual(rows.map(r => r.status), ['normal', 'protected', 'protected'])
  assert.deepEqual(new Set(rows.map(r => r.id)), new Set(['a', 'b', 'd']))
  assert.equal(rows.find(r => r.id === 'a').protected, false)
  assert.equal(rows.find(r => r.id === 'b').protected, true)
})

test('listFreshness 拒绝非法排序列', () => {
  const db = makeDb(); seed(db)
  assert.throws(() => listFreshness(db, { orderBy: 'bogus' }), /orderBy/)
  assert.throws(() => listFreshness(db, { direction: 'sideways' }), /direction/)
})

test('forgetById 按 id 精确软删，返回是否命中', () => {
  const db = makeDb(); seed(db)
  const r1 = forgetById(db, 'a')
  assert.equal(r1.ok, true)
  const remaining = db.prepare('SELECT id, deleted_at FROM insights WHERE deleted_at IS NULL').all()
  assert.deepEqual(remaining.map(r => r.id).sort(), ['b', 'd'])
  const r2 = forgetById(db, 'nonexistent')
  assert.equal(r2.ok, false)
})

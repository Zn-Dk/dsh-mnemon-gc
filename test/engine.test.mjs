import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCandidate, classifyCandidates, summarizeTiers } from '../lib/engine.js'

// 阶段1新语义：tier 由冲突检测结果驱动，不再由时间衰减驱动。
//   superseded 候选 = 冲突检测命中（conflictDetected=true）
//   watch          = 观察项（供人工审阅，不论新旧）
//   immune         = 高重要度/高频引用（importance>=4 或 access_count>=3）
// 新鲜度字段（daysSinceAccess/effectiveImportance）绝不参与 tier 判定。

const base = {
  id: 'm1', content: '旧记忆', category: 'fact',
  importance: 3, accessCount: 0, effectiveImportance: 0.0069,
  daysSinceAccess: 200, edgeCount: 0, immune: false,
}

test('冲突检测命中 → superseded（即使新鲜度正常）', () => {
  const c = classifyCandidate({ ...base, conflictDetected: true, daysSinceAccess: 1, effectiveImportance: 0.9 }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'superseded')
})

test('久未访问但无冲突 → 不判 superseded（核心回归用例：2.1 的误删）', () => {
  const c = classifyCandidate({ ...base, conflictDetected: false }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'watch') // 只观察，不删除
})

test('低 effectiveImportance 但无冲突 → 仍不判 superseded', () => {
  const c = classifyCandidate({ ...base, conflictDetected: false, effectiveImportance: 0.001 }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'watch')
})

test('importance>=4 免疫（即使冲突检测命中也要更强确认）', () => {
  const c = classifyCandidate({ ...base, conflictDetected: true, importance: 4 }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'immune')
})

test('accessCount>=3 免疫', () => {
  const c = classifyCandidate({ ...base, conflictDetected: true, accessCount: 5 }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'immune')
})

test('mnemon 已标记 immune 时尊重其判断', () => {
  const c = classifyCandidate({ ...base, conflictDetected: true, immune: true }, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(c.tier, 'immune')
})

test('classifyCandidates 聚合多个候选并保持输入顺序', () => {
  const items = [
    { ...base, id: 'a', conflictDetected: true },
    { ...base, id: 'b', conflictDetected: false },
    { ...base, id: 'c', importance: 4 },
  ]
  const result = classifyCandidates(items, { threshold: 0.5, maxAgeDays: 30 })
  assert.deepEqual(result.map(r => [r.id, r.tier]), [['a', 'superseded'], ['b', 'watch'], ['c', 'immune']])
})

test('summarizeTiers 按新 tier 计数', () => {
  const tiers = summarizeTiers([
    { tier: 'superseded' }, { tier: 'superseded' }, { tier: 'watch' }, { tier: 'immune' }, { tier: 'immune' },
  ])
  assert.deepEqual(tiers, { immune: 2, superseded: 2, watch: 1 })
})

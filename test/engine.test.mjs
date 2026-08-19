import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCandidate, validatePolicy } from '../lib/engine.js'

// 分级规则（与方案 A 已验证的语义一致）：
//   immune: importance >= 4 OR access_count >= 3
//   stale:  非免疫 且 days_since_access >= maxAgeDays 且 effective_importance < threshold
//   watch:  非免疫 但 days_since_access < maxAgeDays
// 本 seam 测试纯函数 classifyCandidate + validatePolicy。

test('importance >= 4 免疫（即使陈旧）', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'decision', importance: 4, accessCount: 0, effectiveImportance: 0.3, daysSinceAccess: 100, edgeCount: 0, immune: false },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'immune')
})

test('access_count >= 3 免疫', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'fact', importance: 1, accessCount: 3, effectiveImportance: 0.3, daysSinceAccess: 100, edgeCount: 0, immune: false },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'immune')
})

test('mnemon 已标记 immune 时尊重其判断', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'fact', importance: 1, accessCount: 0, effectiveImportance: 0.3, daysSinceAccess: 100, edgeCount: 0, immune: true },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'immune')
})

test('低价值且超过 maxAgeDays → stale', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'fact', importance: 1, accessCount: 0, effectiveImportance: 0.15, daysSinceAccess: 60, edgeCount: 0, immune: false },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'stale')
})

test('低价值但未超过 maxAgeDays → watch', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'fact', importance: 1, accessCount: 0, effectiveImportance: 0.15, daysSinceAccess: 10, edgeCount: 0, immune: false },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'watch')
})

test('effectiveImportance >= threshold → watch（即使陈旧，交给 mnemon 阈值之外的语义）', () => {
  const c = classifyCandidate(
    { id: 'a', content: 'x', category: 'fact', importance: 3, accessCount: 1, effectiveImportance: 0.6, daysSinceAccess: 100, edgeCount: 0, immune: false },
    { threshold: 0.5, maxAgeDays: 30 },
  )
  assert.equal(c.tier, 'watch')
})

test('validatePolicy 接受合法策略', () => {
  assert.doesNotThrow(() => validatePolicy({ threshold: 0.5, maxAgeDays: 30 }))
  assert.doesNotThrow(() => validatePolicy({ threshold: 0, maxAgeDays: 0 }))
})

test('validatePolicy 拒绝非法阈值与年龄', () => {
  assert.throws(() => validatePolicy({ threshold: -0.1, maxAgeDays: 30 }), /threshold/)
  assert.throws(() => validatePolicy({ threshold: 0.5, maxAgeDays: -1 }), /maxAgeDays/)
  assert.throws(() => validatePolicy({ threshold: NaN, maxAgeDays: 30 }), /threshold/)
  assert.throws(() => validatePolicy({ threshold: 0.5, maxAgeDays: 1.5 }), /maxAgeDays/)
})

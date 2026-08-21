import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenPairs, buildDetectionPrompt, parseDetectionResults } from '../lib/conflict-detector.js'

// seam：冲突检测纯逻辑。验证初筛配对、prompt 构建、结果解析。

const mem = (id, content, category, createdAt, extra = {}) => ({
  id, content, category, createdAt, importance: 3, accessCount: 0, immune: false, ...extra,
})

test('初筛：同 category 的旧→新配对', () => {
  const all = [
    mem('a', 'cli 装在 X', 'fact', '2026-08-01'),
    mem('b', 'cli 装在 Y（更新）', 'fact', '2026-08-10'),
    mem('c', '无关记忆', 'insight', '2026-08-05'),
  ]
  const pairs = screenPairs(all, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(pairs.length, 1)
  assert.deepEqual({ o: pairs[0].olderId, n: pairs[0].newerId }, { o: 'a', n: 'b' })
})

test('初筛：免疫候选（importance>=4）不参与', () => {
  const all = [
    mem('a', 'cli 装在 X', 'fact', '2026-08-01'),
    mem('b', 'cli 装在 Y', 'fact', '2026-08-10', { importance: 4 }),
  ]
  const pairs = screenPairs(all, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(pairs.length, 0)
})

test('初筛：免疫候选（accessCount>=3）不参与', () => {
  const all = [
    mem('a', 'cli 装在 X', 'fact', '2026-08-01', { accessCount: 5 }),
    mem('b', 'cli 装在 Y', 'fact', '2026-08-10'),
  ]
  const pairs = screenPairs(all, { threshold: 0.5, maxAgeDays: 30 })
  assert.equal(pairs.length, 0)
})

test('初筛：不同 category 不配对', () => {
  const all = [
    mem('a', '内容一', 'fact', '2026-08-01'),
    mem('b', '内容二', 'decision', '2026-08-10'),
  ]
  assert.equal(screenPairs(all, { threshold: 0.5, maxAgeDays: 30 }).length, 0)
})

test('buildDetectionPrompt 包含每对旧新内容', () => {
  const pairs = [{ olderId: 'a', olderContent: '旧A', newerId: 'b', newerContent: '新B' }]
  const prompt = buildDetectionPrompt(pairs)
  assert.ok(prompt.includes('旧A'))
  assert.ok(prompt.includes('新B'))
  assert.ok(prompt.includes('a'))
})

test('buildDetectionPrompt 空对返回空串', () => {
  assert.equal(buildDetectionPrompt([]), '')
})

test('parseDetectionResults 标记 superseded 对', () => {
  const pairs = [
    { olderId: 'a', olderContent: '', newerId: 'b', newerContent: '' },
    { olderId: 'c', olderContent: '', newerId: 'd', newerContent: '' },
  ]
  const structured = {
    results: [
      { olderId: 'a', superseded: true, byId: 'b', reason: '路径已更新' },
      { olderId: 'c', superseded: false },
    ],
  }
  const results = parseDetectionResults(structured, pairs)
  assert.deepEqual(results, [
    { olderId: 'a', superseded: true, byId: 'b', reason: '路径已更新' },
    { olderId: 'c', superseded: false, byId: undefined, reason: '' },
  ])
})

test('parseDetectionResults 容忍非数组/缺失 results', () => {
  assert.deepEqual(parseDetectionResults(null, [{ olderId: 'a' }]), [
    { olderId: 'a', superseded: false, byId: undefined, reason: '' },
  ])
  assert.deepEqual(parseDetectionResults({}, []), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGcOutput, normalizeCandidate } from '../lib/cli-adapter.js'

// seam 2：CLI 适配层。输入是 mnemon gc 的 JSON 形状（已用真实 CLI 验证），
// 输出是 engine 需要的归一化候选。不碰进程/IO，纯解析。

const gcPayload = {
  total_insights: 3,
  candidates_found: 2,
  candidates: [
    {
      insight: {
        id: 'id-1',
        content: 'alpha deploy checklist',
        category: 'fact',
        importance: 1,
        access_count: 0,
        source: 'user',
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      effective_importance: 0.15,
      days_since_access: 0.0,
      edge_count: 2,
      immune: false,
    },
    {
      insight: {
        id: 'id-2',
        content: 'critical rule',
        category: 'decision',
        importance: 5,
        access_count: 4,
        source: 'user',
      },
      effective_importance: 1.9,
      days_since_access: 60.0,
      edge_count: 4,
      immune: true,
    },
  ],
}

test('parseGcOutput 归一化 candidates 数组', () => {
  const parsed = parseGcOutput(gcPayload)
  assert.equal(parsed.totalInsights, 3)
  assert.equal(parsed.candidatesFound, 2)
  assert.equal(parsed.candidates.length, 2)
})

test('normalizeCandidate 提取字段并保留 immune 标记', () => {
  const c = normalizeCandidate(gcPayload.candidates[0])
  assert.deepEqual(c, {
    id: 'id-1',
    content: 'alpha deploy checklist',
    category: 'fact',
    importance: 1,
    accessCount: 0,
    effectiveImportance: 0.15,
    daysSinceAccess: 0.0,
    edgeCount: 2,
    immune: false,
    conflictDetected: false,
  })
})

test('normalizeCandidate 容忍缺失可选字段（默认 0/空串）', () => {
  const c = normalizeCandidate({
    insight: { id: 'x', content: 'y' },
    effective_importance: 0.2,
    days_since_access: 1.5,
    edge_count: 1,
    immune: false,
  })
  assert.deepEqual(c, {
    id: 'x',
    content: 'y',
    category: '',
    importance: 0,
    accessCount: 0,
    effectiveImportance: 0.2,
    daysSinceAccess: 1.5,
    edgeCount: 1,
    immune: false,
    conflictDetected: false,
  })
})

test('parseGcOutput 容忍 candidates 为 null（无候选）', () => {
  const parsed = parseGcOutput({ total_insights: 0, candidates_found: 0, candidates: null })
  assert.equal(parsed.candidates.length, 0)
  assert.equal(parsed.candidatesFound, 0)
})

test('parseGcOutput 对非数组 candidates 也返回空（容错）', () => {
  const parsed = parseGcOutput({ total_insights: 1, candidates_found: 1, candidates: 'bogus' })
  assert.equal(parsed.candidates.length, 0)
})

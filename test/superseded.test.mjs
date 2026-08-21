import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMarkSupersededArgs, parseSupersededMeta, collectSupersededIds, filterSupersededOnly,
} from '../lib/superseded.js'

test('buildMarkSupersededArgs 构造 causal edge + superseded meta', () => {
  const args = buildMarkSupersededArgs('old-1', 'new-2', '路径已更新')
  assert.deepEqual(args[0], 'link')
  assert.deepEqual(args[1], 'old-1')
  assert.deepEqual(args[2], 'new-2')
  assert.ok(args.includes('--type'))
  assert.ok(args.includes('causal'))
  assert.ok(args.includes('--weight'))
  assert.ok(args.includes('1.0'))
  const metaIdx = args.indexOf('--meta')
  assert.ok(metaIdx >= 0)
  assert.deepEqual(JSON.parse(args[metaIdx + 1]), { superseded: true, reason: '路径已更新' })
})

test('buildMarkSupersededArgs 无 reason 时 meta 省略 reason', () => {
  const args = buildMarkSupersededArgs('a', 'b', '')
  const metaIdx = args.indexOf('--meta')
  assert.deepEqual(JSON.parse(args[metaIdx + 1]), { superseded: true })
})

test('parseSupersededMeta 识别 superseded 标记', () => {
  assert.deepEqual(parseSupersededMeta('{"superseded":true,"reason":"x"}'), { superseded: true, reason: 'x' })
  assert.equal(parseSupersededMeta('{"superseded":false}'), null)
  assert.equal(parseSupersededMeta(null), null)
  assert.equal(parseSupersededMeta('{broken'), null)
})

test('collectSupersededIds 兼容真实列名 metadata', () => {
  const ids = collectSupersededIds([
    { source_id: 'a', metadata: '{"superseded":true}' },
    { source_id: 'b', metadata: null },
  ])
  assert.deepEqual([...ids], ['a'])
})

test('collectSupersededIds 提取已被取代的 source 集合', () => {
  const ids = collectSupersededIds([
    { source_id: 'a', meta: '{"superseded":true}' },
    { source_id: 'b', meta: null },
    { source_id: 'c', meta: '{"superseded":true,"reason":"y"}' },
  ])
  assert.deepEqual([...ids].sort(), ['a', 'c'])
})

test('filterSupersededOnly 拆分允许与拒绝', () => {
  const supersededIds = new Set(['a', 'c'])
  const result = filterSupersededOnly(['a', 'b', 'c'], supersededIds)
  assert.deepEqual(result.allowed.sort(), ['a', 'c'])
  assert.deepEqual(result.rejected, ['b'])
})

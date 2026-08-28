import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, Config, DEFAULT_INTERVAL_MS, DEFAULT_DETECT_MAX_TOKENS } from '../lib/index.js'

// seam：settings 值 → 运行时配置解析。normalizeConfig 是纯函数；
// Config 是 schemastery schema（settings namespace 用），两者必须一致。

test('normalizeConfig 默认值', () => {
  const c = normalizeConfig({})
  assert.equal(c.threshold, 0.5)
  assert.equal(c.maxAgeDays, 30)
  assert.equal(c.intervalMs, DEFAULT_INTERVAL_MS)
  assert.equal(c.limit, 500)
  assert.equal(c.cliPath, undefined)
  assert.equal(c.dataDir, undefined)
})

test('normalizeConfig 透传 cliPath/dataDir', () => {
  const c = normalizeConfig({ cliPath: '/usr/local/bin/mnemon', dataDir: '/data/.mnemon' })
  assert.equal(c.cliPath, '/usr/local/bin/mnemon')
  assert.equal(c.dataDir, '/data/.mnemon')
})

test('normalizeConfig 空串 cliPath/dataDir 归一为 undefined', () => {
  const c = normalizeConfig({ cliPath: '', dataDir: '' })
  assert.equal(c.cliPath, undefined)
  assert.equal(c.dataDir, undefined)
})

test('normalizeConfig 拒绝非法 threshold/maxAgeDays/intervalMs/limit', () => {
  assert.throws(() => normalizeConfig({ threshold: -0.1 }), /threshold/)
  assert.throws(() => normalizeConfig({ maxAgeDays: -1 }), /maxAgeDays/)
  assert.throws(() => normalizeConfig({ intervalMs: 500 }), /intervalMs/)  // 低于 MIN(60s)
  assert.throws(() => normalizeConfig({ limit: 0 }), /limit/)
})

test('Config schema 与 normalizeConfig 默认值一致', () => {
  const resolved = Config({})
  assert.equal(resolved.threshold, 0.5)
  assert.equal(resolved.maxAgeDays, 30)
  assert.equal(resolved.intervalMs, DEFAULT_INTERVAL_MS)
  assert.equal(resolved.limit, 500)
  assert.equal(resolved.cliPath, undefined)
  assert.equal(resolved.dataDir, undefined)
})

test('Config schema 解析 settings 值并透传 cliPath/dataDir', () => {
  const resolved = Config({ threshold: 0.4, maxAgeDays: 60, intervalMs: 3600000, limit: 100, cliPath: '/x/mnemon', dataDir: '/x/.mnemon' })
  assert.equal(resolved.threshold, 0.4)
  assert.equal(resolved.maxAgeDays, 60)
  assert.equal(resolved.intervalMs, 3600000)
  assert.equal(resolved.limit, 100)
  assert.equal(resolved.cliPath, '/x/mnemon')
  assert.equal(resolved.dataDir, '/x/.mnemon')
})

test('normalizeConfig detectMaxTokens 默认值 8192', () => {
  const c = normalizeConfig({})
  assert.equal(c.detectMaxTokens, DEFAULT_DETECT_MAX_TOKENS)
  assert.equal(c.detectMaxTokens, 8192)
})

test('normalizeConfig 透传并校验 detectMaxTokens 边界', () => {
  assert.equal(normalizeConfig({ detectMaxTokens: 16384 }).detectMaxTokens, 16384)
  assert.throws(() => normalizeConfig({ detectMaxTokens: 1023 }), /detectMaxTokens/)  // 低于 MIN
  assert.throws(() => normalizeConfig({ detectMaxTokens: 65537 }), /detectMaxTokens/) // 高于 MAX
  assert.throws(() => normalizeConfig({ detectMaxTokens: 1.5 }), /detectMaxTokens/)   // 非整数
})

test('Config schema 与 normalizeConfig 的 detectMaxTokens 一致', () => {
  const resolved = Config({})
  assert.equal(resolved.detectMaxTokens, DEFAULT_DETECT_MAX_TOKENS)
  const resolved2 = Config({ detectMaxTokens: 32768 })
  assert.equal(resolved2.detectMaxTokens, 32768)
})

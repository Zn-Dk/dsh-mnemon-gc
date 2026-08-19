import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsRpcHandler, SETTINGS_NAMESPACE, SETTINGS_CHANNEL } from '../lib/settings-rpc.js'

// seam：settings RPC handler 纯逻辑（fake SettingsService 注入）。
// 验证 get 返回 descriptor、mutate 白名单、read-only 拒绝、非法 payload 拒绝。

function fakeSettings({ writable = true, value = { threshold: 0.5 } } = {}) {
  const calls = { mutate: [] }
  const settings = {
    writable,
    describe() {
      return [{
        ns: SETTINGS_NAMESPACE,
        value: { ...value },
        base: { threshold: 0.5 },
        user: undefined,
        revision: 3,
        applies: 'live',
      }]
    },
    async mutate(ns, ops, revision) {
      calls.mutate.push({ ns, ops, revision })
    },
  }
  return { settings, calls }
}

test('get 返回 ready descriptor', async () => {
  const { settings } = fakeSettings({ value: { threshold: 0.4 } })
  const handler = createSettingsRpcHandler(settings)
  const res = await handler('get', {})
  assert.equal(res.ok, true)
  assert.equal(res.value.status, 'ready')
  assert.equal(res.value.value.threshold, 0.4)
  assert.equal(res.value.revision, 3)
})

test('mutate 白名单字段透传给 settings.mutate', async () => {
  const { settings, calls } = fakeSettings()
  const handler = createSettingsRpcHandler(settings)
  const res = await handler('mutate', { ops: [{ op: 'set', path: ['threshold'], value: 0.3 }], expectedRevision: 3 })
  assert.equal(res.ok, true)
  assert.equal(calls.mutate.length, 1)
  assert.deepEqual(calls.mutate[0].ops, [{ op: 'set', path: ['threshold'], value: 0.3 }])
  assert.equal(calls.mutate[0].revision, 3)
})

test('mutate 拒绝非白名单字段', async () => {
  const { settings, calls } = fakeSettings()
  const handler = createSettingsRpcHandler(settings)
  const res = await handler('mutate', { ops: [{ op: 'set', path: ['bogus'], value: 1 }] })
  assert.equal(res.ok, false)
  assert.equal(calls.mutate.length, 0)
})

test('read-only settings 拒绝 mutate', async () => {
  const { settings } = fakeSettings({ writable: false })
  const handler = createSettingsRpcHandler(settings)
  const res = await handler('mutate', { ops: [{ op: 'set', path: ['threshold'], value: 0.3 }] })
  assert.equal(res.ok, false)
  assert.match(res.error.message, /read-only/)
})

test('未知 endpoint 返回 bad-request', async () => {
  const { settings } = fakeSettings()
  const handler = createSettingsRpcHandler(settings)
  const res = await handler('bogus', {})
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'bad-request')
})

test('非法 payload（非对象 / ops 超限）拒绝', async () => {
  const { settings } = fakeSettings()
  const handler = createSettingsRpcHandler(settings)
  assert.equal((await handler('mutate', null)).ok, false)
  assert.equal((await handler('mutate', { ops: [] })).ok, false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInspection, runPurge, buildGcArgs, buildForgetArgs } from '../lib/orchestrator.js'

// seam 3：编排层。注入 fake runner（形状对齐 dsh-mnemon 的 MnemonRunner），
// 验证巡检/清理的编排语义与精确 CLI 参数。

function fakeRunner({ gcPayloads = [], forgetResults = [] } = {}) {
  const calls = { gc: [], forget: [] }
  const runner = {
    async runJson(args) {
      if (args[0] === 'gc') {
        const entry = gcPayloads[calls.gc.length] ?? { total_insights: 0, candidates_found: 0, candidates: [] }
        calls.gc.push(args)
        return entry
      }
      if (args[0] === 'forget') {
        const id = args[1]
        const ok = forgetResults.shift() ?? true
        calls.forget.push({ args, ok })
        if (!ok) throw new Error('forget failed')
        return { status: 'deleted', id }
      }
      throw new Error('unexpected args: ' + args.join(' '))
    },
    effectiveDataDir: () => '/root/.mnemon',
  }
  return { runner, calls }
}

const policy = { threshold: 0.5, maxAgeDays: 30 }

const gcWithStaleAndWatch = {
  total_insights: 3,
  candidates_found: 2,
  candidates: [
    {
      insight: { id: 's1', content: 'stale a', category: 'fact', importance: 1, access_count: 0 },
      effective_importance: 0.1,
      days_since_access: 60,
      edge_count: 0,
      immune: false,
    },
    {
      insight: { id: 'w1', content: 'watch b', category: 'fact', importance: 2, access_count: 1 },
      effective_importance: 0.3,
      days_since_access: 5,
      edge_count: 0,
      immune: false,
    },
  ],
}

test('buildGcArgs 精确参数：子命令在前，default 不带 --store', () => {
  assert.deepEqual(buildGcArgs(policy, 'default', 500), ['gc', '--readonly', '--threshold', '0.5', '--limit', '500'])
})

test('buildGcArgs 非 default store 追加 --store', () => {
  assert.deepEqual(buildGcArgs(policy, 'alpha', 500), ['gc', '--readonly', '--threshold', '0.5', '--limit', '500', '--store', 'alpha'])
})

test('buildForgetArgs 精确参数', () => {
  assert.deepEqual(buildForgetArgs('id-9', 'default'), ['forget', 'id-9'])
  assert.deepEqual(buildForgetArgs('id-9', 'alpha'), ['forget', 'id-9', '--store', 'alpha'])
})

test('runInspection 读取 gc 并分级，不触发任何 forget', async () => {
  const { runner, calls } = fakeRunner({ gcPayloads: [gcWithStaleAndWatch] })
  const report = await runInspection(runner, policy, { store: 'default' })
  assert.equal(report.store, 'default')
  assert.equal(report.totalInsights, 3)
  assert.deepEqual(report.tiers, { immune: 0, stale: 1, watch: 1 })
  assert.equal(calls.forget.length, 0)
  assert.deepEqual(calls.gc[0], ['gc', '--readonly', '--threshold', '0.5', '--limit', '500'])
})

test('runPurge 只对 stale 候选调用 forget', async () => {
  const { runner, calls } = fakeRunner({
    gcPayloads: [gcWithStaleAndWatch],
    forgetResults: [true],
  })
  const report = await runPurge(runner, policy, { store: 'default' })
  assert.equal(report.purged, 1)
  assert.equal(report.purgeFailed, 0)
  assert.equal(calls.forget.length, 1)
  assert.deepEqual(calls.forget[0].args, ['forget', 's1'])
})

test('runPurge 对 forget 失败计数 purgeFailed 且不抛', async () => {
  const { runner, calls } = fakeRunner({
    gcPayloads: [gcWithStaleAndWatch],
    forgetResults: [false],
  })
  const report = await runPurge(runner, policy, { store: 'default' })
  assert.equal(report.purged, 0)
  assert.equal(report.purgeFailed, 1)
  assert.equal(calls.forget.length, 1)
})

test('runInspection 对 runner 抛错向外抛（不再吞错）', async () => {
  const runner = {
    async runJson() { throw new Error('cli gone') },
    effectiveDataDir: () => '/root/.mnemon',
  }
  await assert.rejects(() => runInspection(runner, policy, { store: 'default' }), /cli gone/)
})

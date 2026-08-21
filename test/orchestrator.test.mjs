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

const gcWithSupersededAndWatch = {
  total_insights: 3,
  candidates_found: 2,
  candidates: [
    {
      insight: { id: 's1', content: '被取代记忆', category: 'fact', importance: 1, access_count: 0 },
      effective_importance: 0.9,
      days_since_access: 1,
      edge_count: 0,
      immune: false,
      conflictDetected: true,
    },
    {
      insight: { id: 'w1', content: '久未访问但正确', category: 'fact', importance: 2, access_count: 1 },
      effective_importance: 0.3,
      days_since_access: 200,
      edge_count: 0,
      immune: false,
      conflictDetected: false,
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
  const { runner, calls } = fakeRunner({ gcPayloads: [gcWithSupersededAndWatch] })
  const report = await runInspection(runner, policy, { store: 'default' })
  assert.equal(report.store, 'default')
  assert.equal(report.totalInsights, 3)
  assert.deepEqual(report.tiers, { immune: 0, superseded: 1, watch: 1 })
  assert.equal(calls.forget.length, 0)
  assert.deepEqual(calls.gc[0], ['gc', '--readonly', '--threshold', '0.5', '--limit', '500'])
})

test('runPurge 只对 superseded 候选调用 forget', async () => {
  const { runner, calls } = fakeRunner({
    gcPayloads: [gcWithSupersededAndWatch],
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
    gcPayloads: [gcWithSupersededAndWatch],
    forgetResults: [false],
  })
  const report = await runPurge(runner, policy, { store: 'default' })
  assert.equal(report.purged, 0)
  assert.equal(report.purgeFailed, 1)
  assert.equal(calls.forget.length, 1)
})

test('runInspection 注入 detectFn 后冲突检测驱动 superseded 分级', async () => {
  const { runner, calls } = fakeRunner({ gcPayloads: [gcWithSupersededAndWatch] })
  // 覆盖检测：把 w1（久未访问但正确）判为不冲突，s1 保持 conflictDetected=true
  const report = await runInspection(runner, policy, {
    store: 'default',
    detectFn: async ({ pairs, prompt }) => {
      assert.ok(pairs.length > 0)
      assert.ok(prompt.length > 0)
      return { results: pairs.map(p => ({ olderId: p.olderId, superseded: p.olderId === 's1' })) }
    },
  })
  assert.equal(report.tiers.superseded, 1)
  assert.equal(report.tiers.watch, 1)
  assert.equal(calls.forget.length, 0)
})

test('runInspection 未注入 detectFn 时保持分级（不检测）', async () => {
  const { runner } = fakeRunner({ gcPayloads: [gcWithSupersededAndWatch] })
  const report = await runInspection(runner, policy, { store: 'default' })
  // 未检测：s1 的 conflictDetected 来自 fixture 原值 true；w1 false
  assert.equal(report.tiers.superseded, 1)
  assert.equal(report.tiers.watch, 1)
})

test('runInspection 对 runner 抛错向外抛（不再吞错）', async () => {
  const runner = {
    async runJson() { throw new Error('cli gone') },
    effectiveDataDir: () => '/root/.mnemon',
  }
  await assert.rejects(() => runInspection(runner, policy, { store: 'default' }), /cli gone/)
})

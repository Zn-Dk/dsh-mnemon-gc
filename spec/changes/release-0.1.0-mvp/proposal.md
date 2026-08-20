# 变更提案：release-0.1.0-mvp

## Why

dsh-mnemon 的记忆体（Mnemon 引擎）从不调用其原生 CLI 的 `gc` 子命令，也不读 `effective_importance` / `access_count` / `immune` 字段——低价值、长期未访问的记忆会无限积累，没有治理通道。已验证 mnemon CLI 原生具备完整的衰减/GC 模型（有效重要性公式 + 免疫线），但 dsh-mnemon 插件没有把它接出来。

本插件（`dsh-mnemon-gc`）把这套能力接出来，作为**独立的正交扩展**（不 fork、不改动 dsh-mnemon），定位为「可向上游 dsh-mnemon 提 PR 的原型」。

## What Changes

- 新增纯逻辑引擎（`lib/engine.js`）：候选三档分级（immune / stale / watch），复刻 mnemon 原生免疫规则（importance>=4 或 access_count>=3 永不 GC）。
- 新增 CLI 适配层（`lib/cli-adapter.js`）：解析 `mnemon gc` 的 JSON 输出。
- 新增编排层（`lib/orchestrator.js`）：`runInspection`（只读巡检）与 `runPurge`（单次巡检后对 stale 候选执行 `mnemon forget` 软删除），巡检失败向上抛错、单条 forget 失败仅计数不中断。
- 新增插件装配层（`lib/index.js`）：
  - 事件驱动自动巡检：per-root-agent 的 `turn-stopping`（通过 `agent.ctx.effect` 绑定，随 agent 销毁自动清理），达到配置的 `intervalMs` 才触发；**自动巡检只报告，绝不删除**。
  - 手动工具 `mnemon_gc_inspect` / `mnemon_gc_purge`，手动命令 `/mnemon-gc inspect|purge`。
  - Host 侧注册 schemastery `Config` schema 到 DSH settings namespace（`applies:'live'` 热更新），配置落盘 `~/.dsh/settings.yaml`。
- 新增 settings RPC 通道（`lib/settings-rpc.js` + `/dsh-mnemon-gc-settings`）与 client 侧设置卡片（`lib/client.js`，`settings.section` slot），排版对齐 dsh-mnemon 自身 `MnemonSettingsCard` 的视觉规范（page/section/sectionHeading 层级、字段网格）。
- 首次建立 `CHANGELOG.md`（Keep a Changelog + SemVer），后续按 feature/fix/chore 分级记录；版本保持 `0.1.0`（首个可验收 MVP，非破坏性变更起点）。

## Impact

- **受影响的规范**：新增 `gc-governance` capability（本提案唯一新增能力，无既有规范可修改）。
- **受影响的代码**：仅本插件仓库（`dsh-mnemon-gc`），不改动 `dsh-mnemon` 或 DSH host 引擎。
- **受影响的用户**：需要治理 Mnemon 记忆体腐化/冗余问题的 DSH 用户；安装方式与蓝本插件 `dsh-tencent-token-dashboard` 对齐（`pnpm pack` 产出 tgz + 直链安装，规避 `link:` 安装缺依赖的已知问题）。
- **验收状态**：MVP 功能层已验证——32 个单测全绿（engine/cli-adapter/orchestrator/config/settings-rpc 五个 seam），端到端真实调用 mnemon CLI（1 免疫 + 1 陈旧 → 正确分级 1 stale → 软删除 → 幂等）验证通过；Web 设置卡片交互已在真实 DSH Web UI 中确认可用、排版正常。

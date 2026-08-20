# Changelog

本项目的所有显著变更都记录在此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-08-21

首个可验收 MVP：把 mnemon CLI 原生的记忆保留衰减模型接进 DSH，提供事件驱动的保守巡检与受监督的清理。基于 dsh-mnemon 的公共 API（`createRunner` / `resolveConfig`），独立插件、不 fork 上游。

### 新增

- 候选分级引擎（`lib/engine.js`）：immune / stale / watch 三档判定，复刻 mnemon 原生免疫规则（`importance>=4` 或 `access_count>=3` 永不 GC）。
- mnemon gc 输出适配层（`lib/cli-adapter.js`）：解析原生 CLI 的 JSON 输出为内部候选结构。
- 巡检/清理编排层（`lib/orchestrator.js`）：`runInspection` 只读巡检失败即抛错；`runPurge` 复用同一次巡检结果对 stale 候选执行软删除，单条 `forget` 失败只计数不中断整体。
- 事件驱动自动巡检：per-root-agent 的 `turn-stopping` 触发（通过 `agent.ctx.effect` 绑定生命周期，agent 销毁自动清理监听），达到 `intervalMs` 才巡检一次；**自动路径只读，绝不清理**。
- 手动工具 `mnemon_gc_inspect` / `mnemon_gc_purge`，手动命令 `/mnemon-gc inspect|purge`。
- Host 侧 settings namespace（`dsh-mnemon-gc`）：schemastery `Config` schema，`applies:'live'` 热更新，配置落盘 `~/.dsh/settings.yaml`。
- Settings RPC 通道（`lib/settings-rpc.js`，`/dsh-mnemon-gc-settings`）与 Web 设置卡片（`lib/client.js`，`settings.section` slot），排版对齐 dsh-mnemon 自身 `MnemonSettingsCard` 的视觉规范。
- 40+ 单元测试覆盖 engine / cli-adapter / orchestrator / config / settings-rpc 五个纯逻辑 seam。

### 已知限制

- 需显式配置 `cliPath` / `dataDir`（当宿主机 mnemon 不在标准 PATH 或需隔离数据目录时）；若后续并入 dsh-mnemon 上游，可复用其现有 CLI 解析逻辑简化此项。
- 多 store 巡检目前仅自动巡检 `default` store；手动工具/命令可指定任意 store。

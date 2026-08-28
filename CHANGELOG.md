# Changelog

本项目的所有显著变更都记录在此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.2] - 2026-08-28

### 新增

- 自动巡检支持多 store：遍历全部 active Memory Space 逐个巡检并逐 store 报告（单 store 失败不中断其余）；候选数量上限对每个 store 生效。
- 冲突检测子代理成本配置化：新增 `detectMaxTokens` 设置（默认 8192，范围 1024–65536），透传为冲突检测子代理的输出 token 上限；dense CJK 场景可调高，成本敏感可调低。设置卡片与 settings RPC 白名单同步支持该字段。

## [0.2.1] - 2026-08-24

### 新增

- 记忆新鲜度面板支持**多 store 合并展示**：默认全选所有 active Memory Space，每行标注 store 标签；可勾选筛选单个 store（`stores` 端点枚举 + `list` 传入 `stores` 数组）。
- store id 白名单校验与路径重派生（防注入/防目录穿越），未知/非法 store 安全回退 `default`；`list` 排序统一在合并层完成。
- 状态 Tag 重新规划配色：**活跃**（绿色 pill）/ **正常**（主题色 pill）/ **已取代**（玫红色 pill），浅色/暗色双主题适配，字重 medium。

### 变更

- 详情/批量删除/单条删除确认改为官方 `Modal`；按钮/搜索框/Tooltip 全部改用官方 `@deepseek-ai/dsh-client-ui-primitives` 组件，移除 `window.confirm`。
- 表格操作列移除，删除入口并入 hover 详情浮层（详情 + 删除）；批量删除统一放在表格上方。
- 浮层（Modal 面板 / hover 浮层 / 状态 Tag）适配半透明主题：关键面写死不透明实色（浅色 `#fff`、暗色 `#232324`/`#2c2c2e`），不再依赖会被主题覆盖的 `bg-layer-*` token。

### 修复

- 修复半透明主题下 Modal 面板与 sticky 操作列透底问题。
- 修复状态 Tag 在 Tooltip 包裹下「已取代」样式异常问题（Tag 裸渲染 + title 提示）。

## [0.2.0] - 2026-08-21

### 变更（破坏性）

- gc 语义从「时间衰减遗忘」改为「正确性纠错」。**不再因「久未访问」建议或执行删除**；只有被更新的记忆明确取代（superseded）的记忆才进入清理范围。
- tier 集合变更：`stale` 废弃 → `superseded`（冲突检测命中）/ `watch`（观察项，只审阅不删除）/ `immune`（保留）。
- `mnemon_gc_purge` 语义从「删除 stale」改为「删除 superseded」。

### 新增

- 冲突检测子代理：同 category 记忆两两配对，LLM 判断「新事实是否覆盖旧事实」，轻量初筛降低 LLM 成本（免疫候选不参与）。
- superseded 标记：以 mnemon causal edge 存储（`superseded: true` metadata + 取代理由），保留旧记忆与可追溯性，不直接删除。
- 批量删除 superseded：视图勾选 + `/mnemon-gc purge-superseded` 命令，仅限已标记 superseded 的记忆，其余自动拒绝；二次确认为自定义 modal（列出每条记忆摘要 + 不可恢复红色警示）。
- 新鲜度视图新增「状态」列（已取代 / 正常）。

### 修复

- 修复 2.1 探针证实的误删问题：三条 200 天未访问的记忆中两条正确记忆被旧引擎全部软删；新引擎对同样的输入输出 watch（不删）。

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

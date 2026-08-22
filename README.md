# dsh-mnemon-gc

Mnemon 记忆体 GC 治理插件。基于 [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) 的公共 API（`createRunner` / `resolveConfig`），把「冲突驱动的正确性纠错」接入 DSH：检测记忆间新事实取代旧事实、默认标记 superseded、仅在显式确认后软删除。自动巡检只报告、绝不删除。

> **声明**：本插件基于 dsh-mnemon 的公共 API（`createRunner` / `resolveConfig`）开发，是独立的正交扩展，不 fork、不改动 dsh-mnemon。定位为「可向上游提 PR 的原型」。

## 背景

dsh-mnemon 的三层记忆里，第三层（记忆体）由 mnemon CLI 引擎支撑。mnemon 自身并不直接对「记忆内容是否已被更新的记忆取代」做纠错，过时记忆会与新事实并存积累。本插件把这套冲突检测能力接出来，作为独立的治理入口。

## 治理模型（0.2.0：正确性纠错，不再是时间衰减）

gc 的判据是「记忆是否被更新的记忆取代（superseded）」，**不是**「多久没被访问」。久未引用的历史记忆只要仍正确就不会被建议清理。

冲突检测：同 category 的记忆两两配对（免疫候选除外），由 LLM 子代理判断「新事实是否覆盖旧事实」。命中后默认**标记 superseded**（以 causal edge 记录取代关系与理由），旧记忆保留可追溯。

## 分级

| tier | 含义 | 会删除吗 |
|---|---|---|
| `immune` | importance>=4 或 access_count>=3，或已标记 immune | 绝不 |
| `superseded` | 冲突检测命中（被更新的记忆取代） | 仅显式确认后 |
| `watch` | 其余全部（含久未访问但正确） | 绝不 |

新鲜度字段（创建时间/引用次数/有效重要性）仅用于排序与人工审阅，绝不单独作为删除依据。

## 设置界面

「设置 → Mnemon GC」卡片（client settings.section slot）提供可视化编辑，即时热更新，并内嵌「记忆新鲜度」面板（只读列表 + 关键词搜索 + 状态筛选 + 排序/分页 + 详情查看 + 受监督的单条/批量删除）：

- 巡检策略：threshold / maxAgeDays / intervalMs / limit（数字，其中 threshold 与 maxAgeDays 仅为辅助字段）
- 运行位置：cliPath / dataDir（文本，留空表示默认）

卡片通过 host 侧 `/dsh-mnemon-gc-settings` RPC 通道读写 settings namespace；新鲜度面板通过 `/dsh-mnemon-gc-freshness` RPC 通道读写记忆列表与删除动作。

## 触发方式

| 方式 | 行为 | 默认 |
|---|---|---|
| 自动巡检 | `agent/turn-stopping` 后，距上次巡检 `>= intervalMs` 触发 | 开，24h，**只报告** |
| 工具 `mnemon_gc_inspect` | 只读巡检，返回 immune/superseded/watch 三级 | 模型可调 |
| 工具 `mnemon_gc_mark_superseded` | 标记一条记忆被另一条取代（写 causal edge，不删除） | 模型可调（显式） |
| 工具 `mnemon_gc_purge_superseded` | 批量删除**已标记 superseded** 的记忆（未标记的自动拒绝） | 模型可调（显式） |
| 命令 `/mnemon-gc inspect|conflicts|mark|purge-superseded` | 手动触发 | 用户可用 |

**安全边界**：巡检带 `--readonly` 绝不写库；purge 走 `mnemon forget`（软删除，可恢复）且只删「已标记 superseded」的记忆；自动巡检**只报告，绝不删除**（无 autoPurge 配置项）。

## 配置

插件注册了 DSH settings namespace `dsh-mnemon-gc`，配置持久化在 `~/.dsh/settings.yaml`，支持热更新（修改后无需重启）。同时提供 **Web 设置卡片**（「设置 → Mnemon GC」）可在 GUI 里直接改这些字段。

```yaml
dsh-mnemon-gc:
  threshold: 0.5          # 有效重要性阈值（仅辅助排序/审阅）
  maxAgeDays: 30          # 无访问 N 天（仅辅助信号，不构成删除依据）
  intervalMs: 86400000    # 自动巡检间隔（默认 24h）
  limit: 500              # 每个 store 的候选上限
  cliPath: ""             # 可选，显式覆盖 mnemon CLI 路径（默认交给 dsh-mnemon 解析）
  dataDir: ""             # 可选，覆盖数据目录（设了它 storageScope 会切到 custom）
```

字段说明：

| 字段 | 默认 | 说明 |
|---|---|---|
| `threshold` | 0.5 | 有效重要性阈值（辅助排序/审阅，不单独决定删除） |
| `maxAgeDays` | 30 | 无访问 N 天（辅助信号，不构成删除依据） |
| `intervalMs` | 86400000 | 自动巡检间隔（最小 60s，最大 30 天） |
| `limit` | 500 | 每个 store 的候选上限（1–1000） |
| `cliPath` | 空 | 显式覆盖 mnemon CLI 路径；空则交给 dsh-mnemon 的 findMnemonCommand 解析 |
| `dataDir` | 空 | 显式覆盖数据目录；非空时 storageScope 自动切 custom |

> 删除只由「superseded 标记」决定：阈值与 maxAgeDays 仅用于新鲜度视图的排序/审阅，绝不单独作为删除依据。

`cordis.patch.yml` 里的 `config` 是 base 层（默认值）；`settings.yaml` 的 `dsh-mnemon-gc` 段是 user 层（覆盖）。两者合并后生效。

## 安装

### 方式 A：源码目录安装（本地开发）

```sh
cd dsh-mnemon-gc
pnpm install
dsh plugin --profile web add "link:/root/proj/dsh-proj/dsh-mnemon-gc"
dsh web
```

> `link:` 安装不会自动把插件自身依赖（`dsh-mnemon` / `schemastery`）装进 profile，可能报 `ERR_MODULE_NOT_FOUND`。本地自测建议先确认 `pnpm install` 在插件目录内完整跑过；正式分发优先用方式 B（对齐蓝本插件 `dsh-tencent-token-dashboard` 的已验证模式）。

### 方式 B：发布包 .tgz 直链安装（推荐）

```sh
pnpm pack   # 生成 dsh-mnemon-gc-<version>.tgz
dsh plugin --profile web add ./dsh-mnemon-gc-<version>.tgz
```

已安装旧版本时，用同样的 `add` 命令安装新 tarball 即可覆盖更新。

重启 `dsh web` 后，「设置 → Mnemon GC」出现设置卡片。

## 测试

```sh
node --test test/*.test.mjs
```

seam：`engine`（冲突驱动分级纯函数）、`conflict-detector`（初筛 + LLM prompt + 结果解析）、`superseded`（causal edge 标记/收集/过滤）、`cli-adapter`（gc JSON 解析）、`orchestrator`（巡检/清理编排，注入 fake runner）、`config`（settings 值解析）、`settings-rpc` / `freshness` / `freshness-rpc`（settings 通道与新鲜度视图纯逻辑）。

## 版本与发布

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)，变更记录见 [CHANGELOG.md](./CHANGELOG.md)（格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)）。每次面向用户的变更按 `新增`（feature）/ `修复`（fix）/ `变更`（chore/breaking）分级记录，并同步递增 `package.json` 的 `version`。

## 与方案 A 的关系

本插件是把已验证的[方案 A 巡检脚本](../.mnemon-gc/README.md)（阈值、幂等、软删除策略）固化为 DSH 插件的形态。方案 A 仍是独立可用的 CLI 巡检器。

## License

MIT
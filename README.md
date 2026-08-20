# dsh-mnemon-gc

Mnemon 记忆体 GC 治理插件。把 mnemon CLI 原生的**有效重要性衰减模型**接进 [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon)，提供事件驱动的保守巡检与受监督的软删除。

> **声明**：本插件基于 dsh-mnemon 的公共 API（`createRunner` / `resolveConfig`）开发，是独立的正交扩展，不 fork、不改动 dsh-mnemon。定位为「可向上游提 PR 的原型」。

## 背景

dsh-mnemon 的三层记忆里，第三层（记忆体）由 mnemon CLI 引擎支撑。mnemon 本身内置了完整的衰减/GC 模型，但 dsh-mnemon 从未调用 `mnemon gc`，也不读 `effective_importance` / `access_count` / `immune` 字段，低价值记忆会一直积累。本插件把这套能力接出来。

## 治理模型（mnemon 原生）

```text
effective_importance =
    base_weight(importance)            # 5→1.0  4→0.8  3→0.5  2→0.3  1→0.15
  * max(1, log(1 + access_count))
  * 0.5 ^ (days_since_access / 30)     # 30 天无访问减半
  * (1 + 0.1 * min(edges, 5))

免疫线：importance >= 4 或 access_count >= 3（永不 GC）
```

## 分级（比 mnemon gc 更保守）

候选只有同时满足下面条件才判为 `stale`（可清理）：

1. mnemon 判定非免疫低价值（`effective_importance < threshold` 且 `importance < 4` 且 `access_count < 3`）；
2. `days_since_access >= maxAgeDays`（默认 30 天）。

其余低分候选判为 `watch`（只报告），免疫条目 `immune`（不碰）。

## 设置界面

「设置 → Mnemon GC」卡片（client settings.section slot）提供 6 个字段的可视化编辑，即时热更新：

- threshold / maxAgeDays / intervalMs / limit（数字）
- cliPath / dataDir（文本，留空表示默认）

卡片通过 host 侧 `/dsh-mnemon-gc-settings` RPC 通道读写 settings namespace。

## 触发方式（决策 D 混合）

| 方式 | 行为 | 默认 |
|---|---|---|
| 自动巡检 | `agent/turn-stopping` 后，距上次巡检 `>= intervalMs` 触发 | 开，24h，**只报告** |
| 工具 `mnemon_gc_inspect` | 只读巡检，返回 immune/stale/watch | 模型可调 |
| 工具 `mnemon_gc_purge` | 软删除 stale 候选 | 模型可调（显式） |
| 命令 `/mnemon-gc inspect|purge [store]` | 手动触发 | 用户可用 |

**安全边界**：巡检带 `--readonly` 绝不写库；purge 走 `mnemon forget`（软删除，可恢复）；自动巡检**只报告，绝不删除**（无 autoPurge 配置项）。

## 配置

插件注册了 DSH settings namespace `dsh-mnemon-gc`，配置持久化在 `~/.dsh/settings.yaml`，支持热更新（修改后无需重启）。同时提供 **Web 设置卡片**（「设置 → Mnemon GC」）可在 GUI 里直接改这 6 个字段。

```yaml
dsh-mnemon-gc:
  threshold: 0.5          # 有效重要性阈值
  maxAgeDays: 30          # 无访问超过 N 天才算 stale
  intervalMs: 86400000    # 自动巡检间隔（默认 24h）
  limit: 500              # 每个 store 的候选上限
  cliPath: ""             # 可选，显式覆盖 mnemon CLI 路径（默认交给 dsh-mnemon 解析）
  dataDir: ""             # 可选，覆盖数据目录（设了它 storageScope 会切到 custom）
```

字段说明：

| 字段 | 默认 | 说明 |
|---|---|---|
| `threshold` | 0.5 | 有效重要性阈值（低于它才可能 stale） |
| `maxAgeDays` | 30 | 无访问超过 N 天才算 stale |
| `intervalMs` | 86400000 | 自动巡检间隔（最小 60s，最大 30 天） |
| `limit` | 500 | 每个 store 的候选上限（1–1000） |
| `cliPath` | 空 | 显式覆盖 mnemon CLI 路径；空则交给 dsh-mnemon 的 findMnemonCommand 解析 |
| `dataDir` | 空 | 显式覆盖数据目录；非空时 storageScope 自动切 custom |

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

五个 seam：`engine`（分级纯函数）、`cli-adapter`（gc JSON 解析）、`orchestrator`（巡检/清理编排，注入 fake runner）、`config`（settings 值解析）、`settings-rpc`（settings 通道纯逻辑）。

## 版本与发布

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)，变更记录见 [CHANGELOG.md](./CHANGELOG.md)（格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)）。每次面向用户的变更按 `新增`（feature）/ `修复`（fix）/ `变更`（chore/breaking）分级记录，并同步递增 `package.json` 的 `version`。

## 与方案 A 的关系

本插件是把已验证的[方案 A 巡检脚本](../.mnemon-gc/README.md)（阈值、幂等、软删除策略）固化为 DSH 插件的形态。方案 A 仍是独立可用的 CLI 巡检器。

## License

MIT

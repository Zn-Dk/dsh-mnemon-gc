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

## 触发方式（决策 D 混合）

| 方式 | 行为 | 默认 |
|---|---|---|
| 自动巡检 | `agent/turn-stopping` 后，距上次巡检 `>= intervalMs` 触发 | 开，24h，**只报告** |
| 工具 `mnemon_gc_inspect` | 只读巡检，返回 immune/stale/watch | 模型可调 |
| 工具 `mnemon_gc_purge` | 软删除 stale 候选 | 模型可调（显式） |
| 命令 `/mnemon-gc inspect|purge [store]` | 手动触发 | 用户可用 |

**安全边界**：巡检带 `--readonly` 绝不写库；purge 走 `mnemon forget`（软删除，可恢复）；自动巡检**只报告，绝不删除**（无 autoPurge 配置项）。

## 配置

```yaml
threshold: 0.5          # 有效重要性阈值
maxAgeDays: 30          # 无访问超过 N 天才算 stale
intervalMs: 86400000    # 自动巡检间隔（默认 24h）
limit: 500              # 每个 store 的候选上限
cliPath: ""             # 可选，显式覆盖 mnemon CLI 路径（默认交给 dsh-mnemon 解析）
dataDir: ""             # 可选，覆盖数据目录
```

## 安装

```sh
cd dsh-mnemon-gc
pnpm install
dsh plugin --profile web add "link:/root/proj/dsh-proj/dsh-mnemon-gc"
dsh web
```

> 注意：安装出树插件后需先 `pnpm install` 再重启 `dsh web`。

## 测试

```sh
node --test test/*.test.mjs
```

三个 seam：`engine`（分级纯函数）、`cli-adapter`（gc JSON 解析）、`orchestrator`（巡检/清理编排，注入 fake runner）。

## 与方案 A 的关系

本插件是把已验证的[方案 A 巡检脚本](../.mnemon-gc/README.md)（阈值、幂等、软删除策略）固化为 DSH 插件的形态。方案 A 仍是独立可用的 CLI 巡检器。

## License

MIT

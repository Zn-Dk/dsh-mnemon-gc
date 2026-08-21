# 提案：gc 语义重构——从时间衰减遗忘改为正确性纠错

## Why

当前 `dsh-mnemon-gc` 的 gc 判据是「时间衰减遗忘」：`effective_importance < threshold 且 days_since_access >= maxAgeDays`。其中 `effective_importance` 的主导项是 `0.5^(days_since_access/30)`——即「多久没被访问」。

**已用实据证实这套语义是错的**（2026-08-21 探针实验）：构造 3 条 imp=3、acc=0、200 天未访问的记忆（A/B 正确且当前仍有效，C 真的过时），`mnemon gc --readonly` 把三条全部判为候选（effective_importance 全部衰减到 0.0069），`runPurge` 把三条全部软删。**引擎无法区分「正确但久未引用」与「真的过时」，会误删正确历史。**

用户明确的 gc 语义是「正确性纠错」：gc 应该处理的是**与当前事实冲突 / 已被证伪**的记忆，而不是「久未引用」的记忆——漫长迭代周期的项目里，老记忆可能完全正确，只是最近没用到，这不是 gc 的理由。

## What Changes

- **废弃时间衰减判据**：删除「`days_since_access >= maxAgeDays` 触发 stale」的判定路径；新鲜度字段（created_at / access_count / last_accessed_at / effective_importance）降级为**辅助信号**，只用于排序、人工审阅、高频引用免疫，绝不单独作为删除依据。
- **新增记忆间冲突检测**：把候选记忆的内容交给一个 LLM 子代理，检测「新事实覆盖旧事实」的冲突（例如「mnemon CLI 装在 /root/proj/dsh-proj/bin」vs 更新的「装在 /root/.local/bin」）。检测结果作为「疑似过时/被取代」候选呈现，**不自动删除**。
- **新增 superseded 标记**：检测到冲突的记忆默认标记为 `superseded`（保留原记忆、记录被哪条/什么事实取代），而非软删。mnemon 是软删（deleted_at），但「标记 superseded」保留更强的可追溯性。
- **删除动作需显式授权**：自动巡检只做「检测 + 报告疑似冲突」（零删除）；删除或标记 superseded 走显式工具/命令，且默认经人工确认。
- **批量删除 superseded**：提供快捷批量能力（视图勾选 + 命令），针对长期积累的 superseded 记忆；但只针对「已标记 superseded」的记忆，绝不对「久未访问」的记忆做批量删除。二次确认用自定义 modal（列出每条记忆摘要 + 不可恢复红色警示），不用浏览器原生 window.confirm。
- **保留现有安全性质**：只读巡检（--readonly）、软删除、单条 forget 失败不中断整体、自动路径零删除。

## Impact

### 受影响的规范
- 新增 `gc-conflict-detection` capability（本提案唯一新增能力）。现有 `gc-governance`（已归档 release-0.1.0-mvp）中的「候选分级 immune/stale/watch」将被**重新定义**：stale 不再由时间衰减决定，而由冲突检测决定。

### 受影响的代码
- `lib/engine.js` - classifyCandidate 的 tier 语义重写：stale → superseded 候选（由冲突检测驱动），watch → 观察项（供人工审阅），immune 保留。
- `lib/orchestrator.js` - runInspection 改为调用冲突检测流程；runPurge 改为「标记 superseded」+「显式删除 superseded」两个独立操作。
- `lib/cli-adapter.js` / `lib/freshness.js` - 基本不动，继续提供原始记忆数据。
- `lib/index.js` - 新增 LLM 子代理冲突检测的工具/命令；自动巡检报告内容从「低有效重要性候选」改为「疑似冲突候选」。
- `lib/client.js` - 新鲜度视图新增「冲突标记」列与「批量删除 superseded」按钮（依赖 superseded 语义）。

### 用户影响
- 用户不再看到「久未访问」记忆被建议清理；改为看到「疑似过时/被取代」记忆被建议标记 superseded。
- 用户可审阅每条冲突候选的理由，人工决定标记或删除。

### API 变更
- 破坏性：`mnemon_gc_purge` 的语义从「删除 stale」改为「标记 superseded」（或显式删除 superseded）。
- 新增工具/命令（候选名）：`mnemon_gc_detect_conflicts`（检测）、`mnemon_gc_mark_superseded`（标记）、`mnemon_gc_purge_superseded`（批量删 superseded）。

### 需要迁移
- [x] 数据库迁移：无需（mnemon.db schema 不动；superseded 用 mnemon 现有 edge/link 或新增标签承载）
- [ ] API 版本提升：0.1.0 → 0.2.0（破坏性语义变更）
- [ ] 用户沟通：CHANGELOG 显著记录「gc 语义从时间衰减改为正确性纠错」
- [ ] 文档更新：README 治理模型章节重写

## 时间线评估

中大型（涉及 LLM 子代理检测 + 引擎语义重写 + 前端视图扩展）。

## 风险

- **冲突检测的准确率**：LLM 判「冲突」可能有误报/漏报。缓解：检测结果只作「疑似」候选，人工确认才标记/删除；且高频引用（access_count 高）或高重要度（importance>=4）的记忆即使判冲突也要更强的人工确认门槛。
- **LLM 成本**：每次巡检都调子代理可能消耗 API 额度。缓解：巡检间隔可配置（已有 intervalMs），且只对「候选记忆」做检测（不是全量）；候选初筛可先用轻量规则（如近期有同类新记忆写入）。
- **与现有 gc 引擎的过渡**：0.1.0 的用户可能仍在用旧语义。缓解：0.2.0 明确标注破坏性变更，旧「purge」语义废弃。

# 规范差异：gc-conflict-detection

## ADDED Requirements

### Requirement: 冲突驱动的 superseded 判定
WHEN 系统巡检记忆库,
系统 SHALL 基于「记忆间新事实覆盖旧事实」的冲突检测判定 superseded 候选，而非基于时间衰减。

#### Scenario: 新事实覆盖旧事实
GIVEN 记忆库存在旧记忆「mnemon CLI 装在 /root/proj/dsh-proj/bin」
AND 存在更新的记忆「mnemon CLI 装在 /root/.local/bin」
WHEN 系统执行冲突检测
THEN 系统将旧记忆标记为疑似被取代
AND 在检测结果中提供取代证据（指向新记忆或新事实）

#### Scenario: 久未访问但正确
GIVEN 一条记忆正确且当前仍有效
AND 该记忆已 200 天未被访问
WHEN 系统执行巡检
THEN 系统不将其判为 superseded 候选
AND 系统不因其「久未访问」而建议删除或标记

#### Scenario: 高重要度或高频引用记忆的冲突判定
GIVEN 一条记忆 importance>=4 或 access_count>=3
AND 冲突检测判断其可能被取代
WHEN 系统呈现检测结果
THEN 系统仍将其列为疑似冲突
AND 系统对其标记/删除要求更强的人工确认门槛（如二次确认或显式理由）

### Requirement: superseded 标记而非直接删除
WHEN 冲突检测确认一条记忆被新事实取代,
系统 SHALL 默认将其标记为 superseded 并保留原记忆，而非直接删除。

#### Scenario: 标记 superseded 保留可追溯
GIVEN 一条记忆被判定为被取代
WHEN 系统标记 superseded
THEN 原记忆内容仍保留在记忆库中
AND 记录「被谁/什么取代」的关系
AND 该记忆在后续检索中不再作为有效事实返回

#### Scenario: 未确认冲突前不删除
GIVEN 一条记忆仅被自动检测为「疑似冲突」
AND 尚未经人工确认
WHEN 系统执行任何删除操作
THEN 该记忆不被删除

### Requirement: 删除需显式授权
系统 SHALL 仅在用户或模型显式触发删除操作时删除记忆；自动巡检路径永不删除或标记。

#### Scenario: 自动巡检零删除
GIVEN 自动巡检检测到若干疑似冲突候选
WHEN 自动巡检完成
THEN 系统仅报告这些候选
AND 系统不对任何候选执行标记或删除

#### Scenario: 显式批量删除仅限 superseded
WHEN 用户显式触发批量删除 superseded 记忆,
系统 SHALL 仅删除已标记为 superseded 的记忆
AND 系统 SHALL 拒绝删除任何未标记 superseded 的记忆。

### Requirement: 新鲜度字段仅作辅助信号
系统 SHALL 将 created_at / access_count / last_accessed_at / effective_importance 仅用于排序、人工审阅与免疫判定，绝不单独作为删除依据。

#### Scenario: 排序与审阅
GIVEN 用户打开记忆新鲜度视图
WHEN 系统展示记忆列表
THEN 系统按用户选择的排序键展示每条记忆的新鲜度字段
AND 系统不因某条记忆 access_count 低或 created_at 早而自动建议删除

### Requirement: 冲突检测的可配置间隔
WHEN 自动冲突检测被启用,
系统 SHALL 遵循配置的巡检间隔（intervalMs），且只对轻量规则初筛后的候选执行 LLM 检测。

#### Scenario: 间隔控制
GIVEN 配置 intervalMs 为 86400000（24 小时）
AND 距上次冲突检测不足 24 小时
WHEN 新的 turn 结束事件到达
THEN 系统不触发新的冲突检测

#### Scenario: 初筛降低 LLM 成本
GIVEN 记忆库包含大量记忆
WHEN 系统执行冲突检测
THEN 系统先用轻量规则（如近期有同类新记忆写入）初筛候选
AND 仅对初筛通过的候选调用 LLM 检测

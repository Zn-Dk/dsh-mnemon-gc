# 规范差异：gc-governance

## ADDED Requirements

### Requirement: 候选分级
系统 SHALL 把每一条 mnemon gc 返回的候选记忆分类为 immune、stale 或 watch 三档之一。

#### Scenario: importance 达到免疫线
GIVEN 一条候选记忆的 importance 字段值为 4 或更高
WHEN 系统对该候选执行分级
THEN 系统将其分类为 immune
AND 该候选不会出现在任何 purge 操作的目标集合中

#### Scenario: access_count 达到免疫线
GIVEN 一条候选记忆的 access_count 字段值为 3 或更高
WHEN 系统对该候选执行分级
THEN 系统将其分类为 immune

#### Scenario: 非免疫且低于阈值且超龄
GIVEN 一条候选记忆非免疫、effective_importance 低于配置阈值、且 daysSinceAccess 达到 maxAgeDays
WHEN 系统对该候选执行分级
THEN 系统将其分类为 stale

#### Scenario: 非免疫但未达超龄条件
GIVEN 一条候选记忆非免疫、effective_importance 低于配置阈值，但 daysSinceAccess 未达到 maxAgeDays
WHEN 系统对该候选执行分级
THEN 系统将其分类为 watch
AND 该候选不会出现在任何 purge 操作的目标集合中

### Requirement: 只读巡检
系统 SHALL 提供一个巡检操作，该操作调用 mnemon CLI 的只读模式且不产生任何数据变更。

#### Scenario: 巡检成功返回分级报告
GIVEN mnemon CLI 可正常调用且返回有效候选列表
WHEN 系统执行巡检操作
THEN 系统返回按 immune/stale/watch 分级的候选清单与统计摘要
AND mnemon 底层数据库不发生任何写入

#### Scenario: mnemon CLI 调用失败
GIVEN mnemon CLI 不可执行或返回非零退出码
WHEN 系统执行巡检操作
THEN 系统向调用方抛出错误
AND 系统不返回看起来成功但内容为空的报告

### Requirement: 受监督清理
系统 SHALL 仅对同一次巡检中被分级为 stale 的候选执行软删除，且软删除操作互相独立、单点失败不影响其余候选。

#### Scenario: 清理仅作用于 stale 候选
GIVEN 一次巡检返回若干 immune、stale 与 watch 候选
WHEN 系统执行清理操作
THEN 系统仅对 stale 候选调用 mnemon forget
AND immune 与 watch 候选不被触碰

#### Scenario: 单个候选软删除失败不阻断整体
GIVEN 一次清理操作涉及多个 stale 候选，其中一个候选的 forget 调用失败
WHEN 系统执行清理操作
THEN 系统继续处理其余候选
AND 系统在返回结果中报告失败候选的数量与错误详情

### Requirement: 自动巡检的只读默认行为
系统 SHALL 在事件驱动的自动巡检路径中禁止任何写操作；清理只能通过显式的工具调用或命令触发。

#### Scenario: 自动巡检触发后不清理
GIVEN 一个 root agent 的 turn 结束事件触发了自动巡检，且巡检发现了 stale 候选
WHEN 自动巡检完成
THEN 系统仅记录巡检报告
AND 系统不对任何 stale 候选执行 forget

#### Scenario: 距上次巡检时间不足时跳过
GIVEN 距上一次自动巡检的时间间隔小于配置的 intervalMs
WHEN 一个新的 turn 结束事件到达
THEN 系统不触发新的自动巡检

### Requirement: 可配置策略
系统 SHALL 通过 DSH 标准 settings namespace 暴露治理策略配置，且该配置支持不重启热更新。

#### Scenario: 配置热更新生效
GIVEN 系统已通过 settings namespace 加载了初始配置
WHEN 用户通过设置页或 settings.yaml 修改了 threshold 或 maxAgeDays
THEN 系统在下一次巡检时使用更新后的值
AND 系统不要求重启宿主进程

#### Scenario: dataDir 显式配置切换作用域
GIVEN 用户在配置中填写了非空的 dataDir
WHEN 系统解析运行时配置
THEN 系统将 storageScope 设置为 custom
AND 系统使用该 dataDir 而非全局默认目录

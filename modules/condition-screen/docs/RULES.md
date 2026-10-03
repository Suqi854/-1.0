# 规则、指标与判断语义

## 有界JSON AST

Node输入接受JSON文本或纯JSON对象；检查通过属性描述符进行，不读getter，不调用toJSON/隐式coercion hooks。拒绝类实例、自定义原型/继承字段、访问器、函数、Proxy、Symbol、循环、稀疏数组和隐藏属性。浏览器入口只接受JSON文本，传对象即拒绝且不反射，以保证Proxy trap不执行。规则外层 `{version:1,root}`；未知属性拒绝。`root`为条件或非空分组。

```json
{
  "version": 1,
  "root": {
    "type": "group", "op": "AND", "children": [
      {"type":"condition","id":"d-trend","timeframe":"D","left":{"kind":"ma","field":"close","window":20},"op":"gt","right":{"kind":"ma","field":"close","window":60}},
      {"type":"group","op":"OR","children":[
        {"type":"condition","id":"w-up","timeframe":"W","left":{"kind":"change_pct","window":1},"op":"gte","right":{"kind":"constant","value":2}},
        {"type":"condition","id":"d-cross","timeframe":"D","left":{"kind":"field","field":"close"},"op":"cross_above","right":{"kind":"ma","field":"close","window":20}}
      ]}
    ]
  }
}
```

每条件 `id` 唯一（1..64位字母/数字/下划线/连字符）。周期只有D/W/M；两侧操作数共享同一周期、来源、复权。操作数不能添加 `timeframe`/`adjustment` 覆盖。多周期分组也要求统一来源/复权，以避免口径混用。

比较符：`gt/gte/lt/lte/eq/neq/cross_above/cross_below`。精确相等比较IEEE数字，不隐式设置误差或自动舍入。阈值必须有限且绝对值≤1e15。非阈值比较两侧单位必须相同，不允许价格与股数/百分比/倍数混比。

边界：最多100个节点，嵌套最多6层，窗口1..250根，偏移0..250根，目录最多6000条，单股单周期最多2000根，总评估节点预算100000。超过输入上限返回`invalid`；运行预算不足的股票保留为`unprocessed`。窗口不足不补齐、不外推。

## 指标定义

以该周期冻结序列中的末根为索引`t`，操作数`offset`默认0，实际目标`u=t-offset`。完成模式先剔除明确形成中的K；完成未知的K保持索引并在所需窗口内使判断无法完成，避免跨缺口凑窗口。窗口按实际K根数而不是日历天。缺交易日不能推断停牌。

| 操作数 | 定义 | 所需根数 | 单位 |
|---|---|---|---|
| `{kind:"field",field,offset?}` | `field[u]`；field可为open/high/low/close/volume_shares | 1 | CNY或股 |
| `{kind:"ma",field,window:N,offset?}` | 均值`field[u-N+1..u]`；field仅价格字段 | N | CNY |
| `{kind:"volume_ma",window:N,offset?}` | 均值`volume_shares[u-N+1..u]` | N | 股 |
| `{kind:"change_pct",window:N,offset?}` | `(close[u]/close[u-N]-1)*100` | N+1 | % |
| `{kind:"prior_high",window:N,offset?}` | `max(high[u-N..u-1])`，明确排除当前 | N+1可访问；计算N | CNY |
| `{kind:"volume_ratio",window:N,offset?}` | `volume[u] / mean(volume[u-N..u-1])` | N+1 | 倍 |
| `{kind:"constant",value}` | 右侧数字阈值 | 0 | 左侧对应单位 |

量比不是实时累计量比，不含分钟进度、预估全天成交量或跨周期比例。基线均值为0时返回`ZERO_BASELINE`，不生成Infinity。形成中周期量比与完整周期量基线的比较带显著标记，不称为最终成交量。qfq价格使用同一qfq数据窗口；上游成交量仍为provider reported unadjusted shares，不推导复权量/换手。

上穿：`left[u-1] <= right[u-1] && left[u] > right[u]`；下穿对称使用`>=`与`<`。当前相等不算穿越。前一根针对每个操作数分别重算完整窗口，任一缺失则无法判断。偏移叠加到相邻样本索引。

所有所需样本根须有有效OHLC和对应成交量；缺任何字段计为不足。负成交量、非正价格、OHLC上下界错误、乱序/重复日期、混来源/复权计为数据失败。不通过缺口插值。成交额缺失不影响可用OHLCV；成交额指标本身被禁用。

正式portable coverage还包含`missing_scheduled_session_dates`、`calendar_gaps_unverified`和`missing_session_note`。若缺日落在所需样本（W/M从首根自然周期起点到所用末根观察日）的范围，返回`MISSING_SCHEDULED_SESSIONS`；范围外已知缺日不污染当前单根字段。若全局缺口检查仍unknown，一期保守返回`CALENDAR_GAPS_UNVERIFIED`，不制造均线或自动跳过缺日。两者都属不足，不擅自诊断为停牌或source failure。

## 保守三值与覆盖状态

一期使用**覆盖优先、未知传播**的保守分组策略：全部子节点都会评估；任何子条件数据失败则分组`failure`，否则任何子条件不足则`insufficient`；数据齐全后才做AND/OR布尔判断。这样OR中的已知满足条件不会掩盖另一个缺样本的条件。此策略刻意区别于“已知true即可短路OR”的经典Kleene真值表；不输出未经完整请求数据支持的成功计数。

| `state` | `decision` | `passed` | 含义 |
|---|---|---|---|
| match | pass | true | 所有请求条件可判定且组合满足 |
| no_match | fail | false | 所有请求条件可判定且组合不满足 |
| insufficient | unknown | null | 窗口/字段/完成证据/非ST/停牌/截止等无法支持判断 |
| failure | unknown | null | 上游错误、数据合同/值/口径冲突 |
| unprocessed | unknown | null | 预算内未处理 |

每个条件保留自己的触发/失败原因，即使组层最终未知。`successful=match+no_match`只是可判定数；`processed=successful+failure+insufficient`。对账：`total=successful+failure+insufficient+unprocessed`。目录层另满足`catalogTotal=excludedTotal+restrictionExcludedTotal+total`。未知ST身份会列出为不足，不能纳入“已核实非ST总数”的表述。

## 时间与证据

D/W/M分别给`expectedLastDate`、`mode`；完整周期末根日期可不同。同一run的共同targetSession观察边界不可改动，各帧cutoffDate必须对应它；不同观察target应另建run。预期末根由本地日历/数据任务提供，引擎不推算节假日。截断晚于cutoff的根，检查实际末根与该周期expected一致。较旧返回`STALE_DATA`，较新返回`FROZEN_DATE_MISMATCH`，不能默默改变冻结目标。

`completionEvidence.kind=calendar`还必须对应明确支持的calendarVersion=exchange-announced-2026-v1，只能验证其2026范围与声明verifiedFrom..verifiedThrough交集；任意字符串不能制造2026证据，2026外不能因提供更大区间而升级。`synthetic`证据只在整个快照明确synthetic且calendarVersion=synthetic-calendar-v1时有效。`mode=include_partial`可显式使用已知形成中周期，样本和条件标出`containsPartial/partialUsed`。calendar未验证的自然已完成根仍unknown。

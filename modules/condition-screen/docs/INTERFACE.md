# 数据消费合同与 portable adapter

## 纯引擎

`screen(snapshot, rule, limits='{}') -> report` 同步执行，没有行情I/O和持久化；输入不被修改。运行环境本地为最终落点。Node接受JSON文本或经描述符检查的纯对象；浏览器公共API只接受JSON文本，对象会直接拒绝、完全不反射，以免Proxy trap执行。来源读取和授权检查在调用方完成。

```js
const snapshot = {
  version: 1, synthetic: false, generation: 'local-ohlcv-' + 'a'.repeat(64),
  targetSession:'2026-09-29', calendarVersion:'exchange-announced-2026-v1', policyVersion:'local-ohlcv-v1',
  directory: {
    status: 'ready', universe: 'CN_MAINBOARD_NON_ST_LEADERS',
    universeVersion:'research-version',sourceNotes:'由研究任务提供的明确名单及来源说明',
    source: 'public-manifest-version', asOf: '2026-09-29',
    entries: [{symbol:'SH600000', name:'已授权本地目录名称', exchange:'SH', board:'mainboard', stStatus:'unknown'}]
  },
  frames: {
    D: {cutoffDate:'2026-09-29', expectedLastDate:'2026-09-29', mode:'completed'},
    W: {cutoffDate:'2026-09-29', expectedLastDate:'2026-09-24', mode:'completed'},
    M: {cutoffDate:'2026-09-29', expectedLastDate:'2026-08-31', mode:'completed'}
  },
  stocks: [{
    symbol:'SH600000', status:'ready',
    suspension:{state:'unknown'}, // updater ready不能代替active证据
    series:{D:{
      status:'ready', sourceKey:'tencent', adjustment:'none', currency:'CNY', volumeUnit:'shares',
      datasetId:'local-ohlcv-' + 'a'.repeat(64), targetSession:'2026-09-29',
      calendarVersion:'exchange-announced-2026-v1', policyVersion:'local-ohlcv-v1',
      requestStartedAt:'2026-09-29T10:00:00Z', completionCutoff:'2026-09-29T10:00:00Z', fetchedAt:'2026-09-29T10:00:01Z',
      sourceTimestamp:'2026-09-29',contentHash:'b'.repeat(64),
      sourceFinality:'unknown',pointInTime:false,volumeBasis:'provider_unadjusted_reported_volume',
      completionEvidence:{kind:'calendar',verifiedFrom:'2026-01-01',verifiedThrough:'2026-12-31'},
      coverage:{requested:200,returned:0,first_date:'2026-09-29',last_date:'2026-09-29',full_history:false,calendar_unverified_rows:0,missing_scheduled_session_dates:[],calendar_gaps_unverified:false,missing_session_note:'示例空窗口，实际由已授权本地store提供'},
      bars:[] // 仅合同骨架；空窗口不足，不代表已获得实际数据
    }}
  }]
};
```

默认明确龙头子池`CN_MAINBOARD_NON_ST_LEADERS`必须提供`universeVersion/sourceNotes/source/asOf/entries`；名单由研究任务提供，本模块不推断行业或龙头，coverage分母按该次冻结列表。保留`CN_MAINBOARD_NON_ST`兼容范围，不默认3052。目录条目：symbol规范`SH/SZ+6位代码`且与exchange一致；board为mainboard，ST状态non_st/st/unknown。名称含ST或退排除；板块/前缀范围外排除。目录日期早于规则所用cutoff，身份判断不足。未知目录状态使用`{status:'unavailable',universe:'CN_MAINBOARD_NON_ST',errorCode:'PUBLIC_DIRECTORY_HTTP_403'}`，引擎返回blocked而不请求来源；全池总数未知时`counts:null`。

股票status ready/error；其他状态不足。停牌证据`state:active|suspended|unknown`，active必须有`verifiedThrough`达到所用全部截止。不推断无K=停牌。没有额外身份/停牌证据的现有上游可能全部unknown，这是正确边界。

每周期series：status ready/error；errorCode可留上游失败代号。ready需要sourceKey、adjustment(none/qfq/hfq)、currency CNY、volumeUnit shares、bars、completionEvidence。核心引擎可消费确有证明的basis；正式portable适配器只允许上游四键，不宣称hfq可用。

所有入口的共同冻结tuple为 `snapshot.generation/targetSession/calendarVersion/policyVersion`；每个所用series的`datasetId/targetSession/calendarVersion/policyVersion`须逐项一致。合法generation为`local-ohlcv-`加64位小写十六进制；只有明确synthetic的快照可使用`synthetic-`加1..96位字母数字/下划线/连字符ID。当前portable v1的dataset_id就是manifest.run_id，不是每序列content_hash；内容hash允许互不相同。缺或混tuple使该股unknown/failure，无法通过直接screen绕过adapter。

同run各周期的`cutoffDate`为共同targetSession观察边界，而`expectedLastDate`与模式仍独立。需要不同观察target时应使用不同run；不能在同run下更改一个周期的target/cutoff。收据时钟独立，不要求不同周期/股票的时钟相同。

完成日历仅识别`exchange-announced-2026-v1`，范围固定2026-01-01..2026-12-31；声明更宽区间或任意非空version无效。合成演示专用synthetic-calendar-v1只能在synthetic=true及synthetic证据下使用。policy仅识别local-ohlcv-v1（合成演示可用synthetic-conditions-v1）。

每bar：date、periodStart、periodEnd、completion(complete/partial/unknown)、sourceKey、adjustment、open/high/low/close、volume_shares。金额必须null。另须sourceTimestamp、sourceFinality=unknown、calendarCompletion=true/false/null、completionBasis、observedLatest=true/false/null。OHLCV每项须为有限数字或显式null；null在所需窗口中返回不足。complete的periodEnd是最终交易session，不能晚于冻结cutoff；partial可有将来的periodEnd。D通常start=end=date；W/M适配器用自然周/月起点作为保守calendar覆盖下界，不声称逐日底层数据齐全。索引必须严格递增。

限制：`symbols?:string[]`、`exchanges?:('SH'|'SZ')[]`、`maxProcessed?:0..6000`。空symbols明确为空；留属性缺省表示不增加此限制。用户限制不能扩大目录/非ST主板范围。

## Portable v1 纯适配入口

```js
adaptPortableDatasets({
  runId,                           // 唯一冻结代
  synthetic: false,                // 只有开发fixture标true
  directory,                      // 本地准备好的公共目录与身份状态
  frames: {
    D: {adjustment:'none',cutoffDate,expectedLastDate:dailyEnd,mode:'completed'},
    W: {adjustment:'none',cutoffDate,expectedLastDate:weeklyEnd,mode:'completed'},
    M: {adjustment:'none',cutoffDate,expectedLastDate:monthlyEnd,mode:'completed'}
  },
  records: [{symbol:'sh600000',key:'1d:none',result:readDatasetResult}],
  suspensionBySymbol: {SH600000:{state:'active',verifiedThrough:cutoffDate}}
}) -> {valid,snapshot,diagnostics,availableSeries}
```

`records.result`来自本地一次冻结代的`readDataset(run_id,symbol,key)`；适配器本身没有这个调用。不得把私人规则加入updater输入，也不得在每次改条件时重抓行情。`availableSeries`只列所选且已通过合同检查的序列，没提供的序列不会合成。

支持registry恰为 `1d:none / 1w:none / 1mo:none / 1d:qfq`，映射到D/W/M。若D选qfq而W/M选none，分别单周期可判定，跨周期同条规则因复权不同关闭判断；不能自动回退none或生成qfq周月。上游lowercase符号映射为uppercase；源身份仍严格`tencent`。

重要映射/检查：

| 上游 | 适配/检查 |
|---|---|
| available=false, state=partial/pending_source/pending | 不产生可用series，所需条件不足 |
| failed_without_data/failed/error | 周期error，上游数据失败；判断unknown |
| available=true | 还需校验实际dataset，不能凭状态填K |
| dataset_id | 必须等于input.runId与snapshot.generation；合法ID格式见上述定义，不混冻结代 |
| symbol/interval/adjustment/source/target_session | 必须与所选股/周期/复权/tencent/冻结cutoff一致 |
| units | CNY；`shares; provider unadjusted reported volume`；amount unavailable=null |
| calendar_version/policy_version/target_session | adapter对所选序列检查共同tuple；核心也独立检查，不能只靠适配器 |
| request_started_at/completion_cutoff/fetched_at | 必须严格带timezone的ISO日期时间（含秒，可含1..3位毫秒）；portable v1逐序列cutoff与request必须为同一绝对时刻，fetched≥request；中国观察日期达到目标日；不同序列时钟可以不同 |
| available=true与state | 只有state=ready可用；failed_without_data/partial等冲突不升级为ready |
| calendar_version/policy_version/content_hash | 必须提供；hash检查64位小写十六进制形状并保留；不声称此层验证哈希算法或内容签名 |
| coverage | returned必须等于实际bars.length；full_history必须false；requested不是实际可用历史长度 |
| coverage.missing_scheduled_session_dates | 必须提供实际报告日期数组；所需样本范围内有缺日则unknown；不自动推断停牌/来源失败 |
| coverage.calendar_gaps_unverified | 必须提供boolean；true时所用窗口无法认证，返回unknown；缺字段不升级为已验证 |
| coverage.missing_session_note | 保存上游解释：上市期、停牌或provider覆盖可能说明缺日；原因仍未判定 |
| complete=true, calendar_completion=true, 已知verified basis | complete；仍受2026覆盖与窗口检查 |
| complete=false, calendar_completion=false, 已知verified basis | partial，只在明确模式下参与 |
| calendar_completion=null或未知basis/冲突组合 | unknown，不升级自然历史周期 |
| period_end_session | 必须有有效日期；缺失不臆造完成截止 |
| source_finality='unknown',point_in_time=false | 原样保留；不证明最终修订、底层全覆盖或历史回测有效 |
| coverage首/末日期与观察标签 | 须对应实际bars首末；末观察标签须达到共同targetSession，完成模式之后再独立选用W/M的末完整根 |
| amount_cny | 必须null，禁止制造历史成交额 |

适配器未知停牌默认unknown；缺官方/独立nonST证据默认stStatus unknown。父提供的name-only manifest不能提升为已证实nonST。完整bar字段、身份或单位缺失会形成failure；required lookback不足形成insufficient，二者decision均unknown。重复series拒绝整个适配输入。

adapter可接收显式`targetSession/calendarVersion/policyVersion`冻结pin（分批必传），每个实际dataset逐项核对；单次旧接口未传pin时，共同tuple从所选且available的实际dataset推导，并核对每个所选dataset及帧截止；没有可用dataset时版本保持unknown，不凭空生成完成证据。没有重新计算content_hash、run哈希或交易日历收盘缓冲；实际数据证明仍由已授权本地updater负责。

## 输出与调试

report包含status(completed/invalid/blocked)、coverageKnown、synthetic、frozenFrames、directory对账、counts、rows、excluded、restrictionExcluded、requestedOutsideCatalog、errors/warnings。row包含symbol/name/directoryAsOf/state/decision/passed；可评估时有完整tree。condition节点包含left/right/previous（交叉）、值、单位、样本日期/窗口/偏移、来源/复权、cutoff/expected/actual、partialUsed、sourceFinality、datasetId/contentHash/fetchedAt和原因码。

`completed`仅代表本次有界引擎调用完成，不等于全数据准备完成。仍可能有failure/insufficient/unprocessed。不要把successful当收益、全池历史、上游已启用或证券可交易证明。

## 公共数据质量边界（0.1.2）

`src/quality.js`对direct screen和portable adapter使用同一组类型、白名单和不变量；不是只修一个flag。series、coverage、bar、完成证据、cache、portable units均拒绝未知属性。所有必需质量字段在所用ready周期评估前完整检查，不能凭缺字段默认[]/false/已验证。`validateSnapshot`检查已给字段的结构/类型，但不代替对所用周期完整性的运行验证；其valid不代表数据就绪或条件通过。已提供空coverage/proof/cache在运行验证中失败。没有使用的缺周期不会被伪造。

sourceFinality只允许unknown、pointInTime只允许false、volumeBasis只允许provider_unadjusted_reported_volume、contentHash必须64位hex。portable v1不接受known_final、point_in_time=true、复权量或未知单位作为可用事实。completion basis未知保留unknown；nullable observedLatest不提供最终性证明。coverage字段全部必需：请求/返回非负有界整数（requested>0）；首末合法日期；full_history=false；calendar_unverified_rows≤returned；missing日期数组且不重复；calendar_gaps_unverified为boolean；missing_session_note非空文字。returned=实际根数≤requested，首末对应实际窗口。cache若提供必须used=true/scope=explicit_local_dataset（portable必需，canonical可省）。

类型/白名单/覆盖矛盾返回invalid或failure/unknown；合法显式null OHLCV、缺历史、未验证完成/停牌等返回insufficient/unknown。二者不得改成no_match。安全JSON拒绝不引发用户getter/Proxy trap，也不允许eval。附录[分批合同](BATCH-CONSUMER.md)说明新的账本API及pool分母。

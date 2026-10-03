
## 公开源码分发能力边界

此技能源码变体为 1.9.29-public.2，配套 1.27.0-public.2 / public-no-credentials-v2。它与运行中的私有服务及正式安装的 1.9.29 技能能力不同。公开云端的 14 个 MCP 名字中，get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 是四个 unsupported 兼容占位；返回 PUBLIC_PROFILE_LOCAL_REQUIRED 和 local_required=true，不读取环境、数据库、凭据或来源，也不写入数据库。get_diagnostics 仅返回被动元数据与当前实例请求观察，不作上游探测。公开代码不含凭据设置、Access 桥或采集器执行流程；不能通过配置密钥启用被移除功能。

云端筛选只接受公开显式代码和固定 swing-daily-v1；私人名单、阈值、条件及结果只在授权本地执行。无密钥 OHLCV 内核已经准备，但真实 loader、连续更新与盘后调度尚未接入。条件模块 0.1.4（开发候选） 只有 10 条虚构池记录及合成行情，不是实际行业龙头池。详见 [公开技能能力声明](../../../PUBLIC-PROFILE.md)。

# 波段筛选契约与公式

本文件记录配套服务本次新增能力的契约，帮助解释结果；它不是连接、部署或工具可见性的证据。调用前检查当前工具目录中的真实 schema，工具不可见或返回失败时不能称已筛选成功。现有单股量价、竞价与多周期分析仍由原有 `ashare-analysis` 技能处理。

## 当前版本与未完成范围

本公开源码 1.27.0-public.2 保留 14 个 MCP 名字，其中 get_stock_directory/get_auction_snapshot/get_auction_series/get_archive 为 unsupported，占位名字不是可执行能力。get_diagnostics 被动，云端筛选 schema 收缩为 explicit 固定预设。技能源码变体 1.9.29-public.2 不改变另一部署或正式安装的技能。

先读 [盘后完成与留存边界](../../ashare-analysis/references/data-coverage.md#盘后完成与留存边界)：云端无行情数据库读写或持久回退，get_archive 为 unsupported；默认 schema/SQL 不建表、不迁移、不删表，云构建无 SQL writer 或 portable 存储依赖。私人资料与获授权手工留存只在显式 127.0.0.1 Node 宿主，须有 Node DatabaseSync 工厂签发的不可变开放能力；D1、任意 env、JSON 标记和已关闭实例均被拒绝。此次源码交付未启动实际本地服务。本地 OHLCV 内核尚未接真实 loader/路由/连续或盘后调度；条件模块 0.1.4（开发候选） 仅有 10 条虚构池记录的合成页面，不是实际行业龙头池或策略验证。

## get_swing_screen 输入

公开云端 schema 只允许：

- `symbols`：必填，1–20 个公开 A 股代码；不接受中文名称，名称先由实际可用报价工具核对唯一精确身份
- `universe`：仅 `explicit`，默认值也是 `explicit`

`additionalProperties=false`。不发送 original_watchlist、after、thresholds、interval、limit、adjustment、历史截止日、收益目标、优化、评分或私人条件。固定 preset 为 swing-daily-v1：

| 固定字段 | 默认 | 含义 |
| --- | ---: | --- |
| `breakout_volume_ratio` | 1.5 | 趋势初起的最低 20 日量比 |
| `continuation_volume_ratio` | 0.8 | 趋势延续的最低 20 日量比 |
| `continuation_near_high_pct` | 5 | 趋势延续允许低于前 20 根最高价的百分比 |
| `max_extension_ma20_pct` | 12 | 高于 MA20 的过热提示阈值 |
| `max_return_5d_pct` | 20 | 最近 5 根收益率的过热提示阈值 |

这些是公开研究假设，不是已验证最优值。私人名单和阈值调整需另有真实支持的授权本地路径；本源码没有云端私人规则或自选功能。

## 固定数据门槛

腾讯qfq日线仍请求200根，至少65根有效完整日线且最近65根在已核2026交易日历中无缺口。本公开服务按冻结请求开始时刻的latest completed session取目标日：Asia/Shanghai严格晚于15:30:03且目标日确为交易日时，当天有效新取行可入样；恰好该时刻及之前、未来/未完成行排除。请求响应跨线不能升级开始时尚未完成的当天。目标日缺失/陈旧、身份/值/来源/非缓存检查或65会话证据不满足，仍为insufficient_data。source_finality=unknown，不认证临时停市、停复牌、最终修订或可成交。

来源无效、样本不足、源陈旧、日历未知、缺少交易会话等返回insufficient_data；不自动改用未复权、其他来源或缓存。get_bars常规返回与此门槛不自动等价：include_incomplete=false不能替代目标会话、calendar_completion、腾讯qfq/非缓存、65会话连续覆盖及合法数值检查。rules.version仍swing-daily-v1，eligibility_version改为verified-postclose-v2，公式与阈值未改。

## 公式与阶段

设最后一根有效日线为 t，收盘 C、最高 H、成交量 V；所有“日”均指交易条形，不是自然日。简单均线包含 t；前高和均量不包含 t。

- MA20[t] = 最近 20 根收盘价的简单平均；MA60[t] = 最近 60 根的简单平均
- `prior_high20` = H[t−20] 至 H[t−1] 的最高值；不是收盘价最高值
- `prior_mean_volume20` = V[t−20] 至 V[t−1] 的平均值；`volume_ratio20` = V[t] / 该平均值
- `return_5d_pct` = (C[t] / C[t−5] − 1) × 100
- `extension_ma20_pct` = (C[t] / MA20[t] − 1) × 100
- `ma20_change_5d_pct` / `ma60_change_5d_pct` = (对应 MA[t] / MA[t−5] − 1) × 100

趋势初起 `emerging` 同时满足：

1. C[t] > MA20[t]
2. MA20[t] > MA20[t−5]
3. C[t] 严格大于 `prior_high20`
4. `volume_ratio20` ≥ `breakout_volume_ratio`

不以昨天是否已经突破作为排除条件。当前 C[t] > `prior_high20` 时，若 C[t−1] 也严格大于 H[t−21] 至 H[t−2] 的最高值，`breakout_kind=repeated`，否则为 fresh；当前未突破时为 null。它只描述相邻两根的突破关系，不是另一套入选门槛，也不是首次启动或主升浪的认证。

趋势延续 `continuation` 同时满足：

1. C[t] > MA20[t] > MA60[t]
2. MA20 与 MA60 都高于各自 5 根前的值
3. C[t] ≥ `prior_high20` × (1 − `continuation_near_high_pct` / 100)
4. `volume_ratio20` ≥ `continuation_volume_ratio`

两支独立判断，两者都满足时阶段优先为延续；否则只有突破分支满足时为初起。MA60 不是初起分支的入选条件，但数据门槛仍统一要求 65 根。符合任一支为 `match`；数据满足门槛但两支都不符合为 `not_match`。不要把“未匹配”解释为未来不会涨。

过热是独立提示：`extension_ma20_pct` > `max_extension_ma20_pct`，或 `return_5d_pct` > `max_return_5d_pct`。严格大于才触发，不是大于等于；过热不取消匹配，未触发也不认证安全。过热阈值、量比阈值、趋势窗口不包含收益保证。

## 输出核对

顶层读取 `rules` 的默认/实际阈值与公式、`universe` 的本次显式范围、`summary` 及 `results`。显式代码规范化并去重后保留输入顺序；重复输入不算新增扫描对象。逐项核对：

- `status`：`match` / `not_match` / `insufficient_data`
- `phase`：`emerging` / `continuation` / null
- 每个结果顶层的 `breakout_kind`：fresh / repeated / null，仅作突破描述，不冒称首次或必然起涨；错误行可能没有此字段
- `reason_codes`、`checks`、`risk_flags` 与警告：逐项解释，不把缺失视为 false 或零
- `metrics`：`close`、`ma20`、`ma60`、`ma20_change_5d_pct`、`ma60_change_5d_pct`、`prior_high20`、`volume_shares`、`prior_mean_volume20`、`volume_ratio20`、`return_5d_pct`、`extension_ma20_pct`
- 样本数量与首末日期、`provenance` 的来源、复权、源时间和接收时间、`freshness`：按实际字段读，不根据示例补字段值

价格按服务明确单位解释，前复权价格不可直接作为当前未复权成交价。成交量为股，量比为倍，涨幅/偏离为百分比。`amount_cny=null` 不能用收盘价乘股数补成真实成交额。错误行的 `metrics`、`checks`、`sample`、`provenance` 可能为 null；不能补零、编值或据此排序。

波段筛选接口本身不提供股票目录、财务筛选、行业历史相对强弱、点时可交易证券池或成交执行模拟；目录接口也不认证交易所全市场完整覆盖；不认证 ST、上市/退市历史、停牌与实际可交易状态。只保存或取得当前历史序列时，规则回放是事后诊断，不是当时可得数据的回测。历史赢家可用于解释规则，不用其结果调参、宣称本应必然提前选中，或回填不存在的历史提醒。


## 股票目录 get_stock_directory

此公开源码只保留 legacy 名字/schema。调用返回 available=false、data_status=unsupported、code=PUBLIC_PROFILE_LOCAL_REQUIRED，不读环境、数据库、凭据或来源，source_requests=0。它不返回来源目录、分页数据或账户记录；空 items 不是成功空目录。

旧凭据-backed 目录执行说明已移除。密钥配置、诊断或其他旧入口不能启用它，公开源码也不提供迁移/恢复流程。当前无凭据替代是下节 get_mainboard_universe，只覆盖固定沪深普通主板且排除 ST 名称，不等价于通用全 A 股目录。

用户要求替代范围以外的证券时，使用无私有内容的明确公开代码或已核实能力与授权的独立本地资料；资料未取得时报告未覆盖，不能假装有全市场池。

## 固定主板目录 get_mainboard_universe

### 当前公开无凭据契约

公开服务 1.27.0-public.2/schema2026-10-03.public.2 使用 `{}`、`additionalProperties=false`，不接受symbols、universe、offset、limit、URL、key、owner、阈值或源覆盖。仅需Site访问认证；活动分支不向目录reader传env/数据库/账户身份/个人key/私有策略，不读保存或全局key，也不回退HiThink。冷刷新并行固定3个无凭据GET：

1. 上交所公开主板A股JSON：query.sse.com.cn/sseQuery/commonQuery.do，固定STOCK_TYPE=1、sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L、COMPANY_STATUS=2,4,5,7,8、首屏size2000/page1
2. 深交所主板A股XLSX：[固定来源](https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1&selectModule=main)
3. 深交所首屏JSON元数据：[固定来源](https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=1&selectModule=main)

出站credentials:omit、拒绝重定向，无Cookie/Authorization/APIkey/token/用户特定值；单源20秒/整次25秒，沪JSON3MiB、深XLSX2MiB、元数据256KiB。不翻75页、不自动重试/换host/付费源，不读报价/历史、自选/私有策略，不写配置/凭据、不调采集器或bridge。三响应全部有效并对账才有可用池，不能把部分成功拼成空池或完整池。

沪市result和pageHelp.data身份须一致，官方A股/主板标签、返回数=total、pageCount1且≤2000；未来超界显式失败，不静默漏项。深市精确A股列表sheet、唯一六位字符串代码、无歧义必需列、主板标签、严格上市日期；XLSX数与metadata recordcount、首屏身份/名称/日期匹配。XLSX解析限额及不安全/歧义格式拒绝仍由服务负责，技能不临时下载/抓取替代数据。

官方公共目录可用于云端公开研究；个人密钥、自定义策略和私人资料仍只在授权本地。此公开源码已排除凭据设置、专有来源请求、Access 桥和采集执行；get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 四个云端兼容名字 unsupported，诊断不作探测，不存在旧云存 key fallback 或配置恢复流程。

### 分类与身份

`source=sse_szse_public`，`universe_version=manifest_version=mainboard-public-directory-v1`，`directory_version=sse-szse-public-v1`；scope仍为sh_sz_mainboard_excluding_st_names，固定数值规则不变：

| 市场 | 固定分类器的普通主板范围 | 排除/未知边界 |
| --- | --- | --- |
| SH | 600、601、603、605开头，且身份/支持语法有效 | 688/689科创板及CDR排除；不能笼统纳入所有60x |
| SZ | 000001–004999且现有格式支持，排除001001–001199主板CDR | 原中小板002保留；300/301创业板排除；001000在固定范围内但规则不证明存在/上市 |
| BJ | 不纳入沪深主板 | 不能用来源缺项推断证券不存在 |

官方当前目录标签提高当次来源范围证据，不认证完整历史成员或可交易状态。market/ticker/symbol/thscode/asset_type、source_id、官方主板标签与支持标记须一致，身份/重复/来源计数/日期/元数据矛盾则整次失败。先归unsupported；其余归excluded_other_boards/unclassified/excluded_st_name/eligible_mainboard_non_st，五类互斥且穷尽实际来源行。原名保留，NFKC/trim后大小写不敏感前导ST/*ST过滤；来源提示不一致只保留warning，不增第六类。名称前缀仍不是官方风险警示状态。

证券代码分类参考沿用[上交所2026年第三次证券代码指南](https://www.sse.com.cn/lawandrules/guide/stock/jyglywznylc/zn/c/c_20260831_10830435.shtml)、[深交所2026年3月证券代码区间表](https://www.szse.cn/marketServices/technicalservice/doc/P020260306733846760075.pdf)既有2026-10-01核对记录，官方分配、服务分类与当前/历史成员资格分开；范围变化时重新核实。

### 时钟、hash与覆盖

成功核对available/data_status/read_only/scope、上述公共版本、64位小写SHA-256 manifest_hash、credential_required=false/credential_reads=false/cloud_bridge_requests=false；items、sources、coverage.source_breakdown、cache/served_at、expected_session_date、rules.version=swing-daily-v1/default thresholds/未验证假设标记、coverage/warnings/service。结果只按本次公共版本和实际来源计数对账，不套用历史其他来源池或固定总数。

`source_timestamp=null`，语义no_certified_common_source_effective_timestamp；snapshot_timestamp仅为local_combined_directory_receipt_identifier_not_membership_effective_time，fetched_at是组合原接收时间。sources分别保存SSE/SZSE日期及原取数时间，SSE日期缺失保留null，SZSE展示日期不是经认证的成员生效日期。served_at是本次服务时间，不改源日期或原接收时刻。

hash规范排序完整分类公开身份、分类规则与各source_id来源依据；行/来源顺序、fetch时刻/组合接收标识/本次served_at、完成会话截止日不改变hash，来源展示日期可能改变hash。没有SHA-256就失败，不换弱hash；hash不认证真实性、市场完整、原子行情或历史成员。纯函数builder在实现/测试内保留完整manifest/classifications，dispatcher仍省略这两份重字段；不能仅用入围items重算完整hash或补造未传输的排除明细。保留的纯 legacy 分类器只作离线兼容审查，未接活动入口且无 I/O；不是目录 fallback。

`provider_rows = eligible_mainboard_non_st + excluded_st_name + excluded_other_boards + unclassified + unsupported`

入围items数须等于eligible_mainboard_non_st；coverage.source_breakdown分别对账来源行数/ST名称排除/入围数。source_response_count=3、source_counts_reconciled=true、两所当前来源count之和不代表经认证的历史/原子成员数；complete_exchange_universe=false、ordering_and_atomicity=not_atomic保留，不把当前官方计数对账升级成全时点完整证券池。

### 公共缓存与失败

仅Worker-isolate内存缓存已全部校验的公共快照6小时且限同上海日期；并发single-flight共用一次刷新。cold isolate可能重新三GET，不是全局/持久缓存、后台更新或用户私有存储。cache.kind=fetched/fresh_cached/stale_fallback及原fetch时钟按本次结果读取；current_call_started_outbound_requests区分冷/失败刷新3与命中/冷却/共享等待0，字段缺失时不编造取源次数。

失败触发isolate内60秒冷却、无自动重试。存在已验证旧公共快照时，只能同上海接收日且≤24小时stale_fallback，明确刷新失败/非新鲜，保留原source dates/fetch clocks/local snapshot/hash。跨日、超龄或无旧快照则available=false、data_status=public_source_unavailable、coverage=null，不能用items=[]报告零股票。冷却过后仅新的明确调用可以恢复，不设后台重试。

按实际安全diagnostics.code/reason_codes报告访问拒绝/限流、超时、重定向/MIME/正文、SSE身份/范围/计数、SZSE元数据/工作簿计数身份冲突或XLSX解析/运行环境不支持；PUBLIC_DIRECTORY_XLSX_PARSE_FAILED与PUBLIC_DIRECTORY_XLSX_RUNTIME_UNSUPPORTED不猜成key失效。部分源成功不可用；不能回退HiThink、读取key、自动换源或把原始错误/响应体展示成安全诊断。

### 证据与数据许可边界

此源码的构建/离线测试支持实现不变量，不证明当前官方来源可访问、真实目录齐备或筛选完成。先前另一版本的单次来源观察也不是本变体实时状态；公共池总数以本次有效结果为准，不套用历史其他来源计数。访问拒绝须明确列作阻塞，安全 source/time/status 只帮助归因，不能恢复被移除能力。

[上交所法律声明](https://www.sse.com.cn/home/legal/)与[深交所声明](https://www.szse.cn/application/laws/)中的公开可得不授权转售/商业再分发；准确性、完整性、时效不获保证。软件许可不授予行情数据许可；保留 仓库 `docs/mainboard-screening-contract.md` 中的设计参考与许可记录（独立技能包不包含该仓库文档），没有复制 RQAlpha 存疑源码或选择新项目许可。

### 冻结代次与逐批账本

本次用户启动时固定hash/公共目录版本/各source provenance与日期/原接收及cache时钟/入围身份、expected_session_date、swing-daily-v1及公开默认阈值。不向新目录接口传扫描参数。随后复用原get_swing_screen显式代码参数，顺序每批最多20只；并发3、单源6.5秒与市场取数24秒预算、腾讯qfq、65根及公式/阈值不变，日线完成资格改为verified-postclose-v2。批次须与冻结expected_session_date一致，跨盘后门槛/代次则要求新运行，不混拼。批次时间不是同一原子行情快照。

`eligible_mainboard_non_st = match + not_match + insufficient_data + failed_without_result + pending`

逐项结果要与当批精确代码对应且无缺项/重复/池外，规则/defaults/cutoff与冻结代次一致。match/not_match必须有精确截止日、65根sample、腾讯qfq provenance、有效时间与有限数值、相互一致的checks/phase/status。合法insufficient_data维持该类别；来源超时导致expected_session_date=null时也不改计请求失败，但要核对其合法形状与缺数原因。没有可信逐项结果的整批失败、缺项或形状不符归failed_without_result；不能用summary零值替代。

暂停等正在请求一批结束后停止新批次。Continue仅处理pending；Retry Failed仅由用户触发，处理failed_without_result，不重跑有效insufficient_data；不自动重试、优化、换源或诊断探测。认证/请求错误暂停。新截止日、版本或defaults锁住继续/重试，须明确开始新代次；失败恢复以验证后的终态替换失败，不重复计数，不改旧有效结果。

只有failed_without_result与pending均为零才显示“本次名单已全部处理”；数据不足仍是不可判定，不说所有股票已可靠判定，更不说交易所全量扫描。pending=0但失败仍存在只可称已尝试处理并列失败数。过热不删除match，展示过滤不更改账本；无过热不代表低风险。

### 页面任务的生命周期

服务页面由用户明确点击按公共缓存契约取得本次目录并启动批次；命中cache不是每次都重新三GET。只是页面内运行，不是后台服务或提醒。关闭页面不会继续或持久保存账本；隐藏页面停止后续批次，当前请求可完成，返回不自动恢复。切换四个同页工作视图保留并继续已启动任务；切换动作本身不额外请求数据、启动新任务或控制采集器，已启动筛选仍会发后续批次。页面恢复期间也须保持物理single-flight，旧代次不能写新结果。重新运行经确认替换本页结果，不拼代次。

公开页面保留明确公开代码的固定手动筛选与公共主板批次；云端私人自选和旧通用目录功能不可用。一次目录成功不代表所有日线批次成功、真实本地接入或页面端到端验收。离线 fixture/DOM/路由检查不能认证实际桌面/移动视觉或登录交互。

## 通用完整目录范围与降级

固定公共模块仅覆盖沪深普通主板且排除 ST 名称。用户要求保留 ST、其他板块或全 A 股时，使用无私有内容的明确公开代码，或已核实能力/授权的独立本地资料；不能悄悄套用较小范围后声称完成原请求。get_stock_directory 在本源码始终 unsupported，没有可恢复的旧分页流程。

独立本地资料须说明实际来源、日期、代码区间、未知/不支持数和名称过滤策略；它不是本公开工具已取得目录的证据。工具未进入当前会话或公共目录不可用时，如实报告池未取得、未扫描范围及阻塞。有限公开名单可继续研究，但失败 items=[] 或未处理成员不能记作零候选。


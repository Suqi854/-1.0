
## 公开源码分发能力边界

此技能源码变体为 1.9.29-public.2，配套 1.27.0-public.2 / public-no-credentials-v2。它与运行中的私有服务及正式安装的 1.9.29 技能能力不同。公开云端的 14 个 MCP 名字中，get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 是四个 unsupported 兼容占位；返回 PUBLIC_PROFILE_LOCAL_REQUIRED 和 local_required=true，不读取环境、数据库、凭据或来源，也不写入数据库。get_diagnostics 仅返回被动元数据与当前实例请求观察，不作上游探测。公开代码不含凭据设置、Access 桥或采集器执行流程；不能通过配置密钥启用被移除功能。

云端筛选只接受公开显式代码和固定 swing-daily-v1；私人名单、阈值、条件及结果只在授权本地执行。无密钥 OHLCV 内核已经准备，但真实 loader、连续更新与盘后调度尚未接入。条件模块 0.1.3 只有 10 条虚构池记录及合成行情，不是实际行业龙头池。详见 [公开技能能力声明](../../../PUBLIC-PROFILE.md)。

# 数据覆盖与指标口径

本技能不连接或部署 MCP。先发现当前可用的行情工具并阅读 schema、description 和本次结果；参数和覆盖以实际工具为准。以下是本公开源码当前保留的接口契约；get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 四个云端兼容名字另标为 unsupported。源码存在不代表用户已连接或上游一定返回数据。

- `get_quotes`：`symbols` 为 1–20 个 A 股代码；`include_book` 默认 true。报价来源腾讯/新浪并行择优，具体选源依据及警告以结果为准。市场前缀、币种、源时间、接收时间、时效、单位及来源警告均按结果核对；五档盘口是单时点、单来源，非逐单 Level-2
- `get_bars`：`symbol`、`interval` 必填。周期 `1m`/`5m` 最大 240 条；`1d`/`1w`/`1mo` 最大 600 条，`limit` 默认 120。`adjustment` 为 `none`（默认）/`qfq`/`hfq`，分钟线仅 none；`include_incomplete` 默认 false。历史成交额缺失为 null，成交量使用未作价格复权的股数；不可把“取到600条”称为上市以来全历史
- `get_intraday`：`symbol`；`include_incomplete` 默认 false。返回最近会话的分钟价格和累计量、区间差分量；第一点差分未知为 null。以 `session_date` 判断是哪天，不能默认今天。`interval_minutes` 可能大于1；午休或缺口的差分不能称一分钟成交量。`full_session_guaranteed=false`、`tick_by_tick=false`
- `get_macd`：`symbol`、`interval`；`limit` 默认120，最大300；`adjustment` 与 `include_incomplete` 同 K 线。用收盘价 EMA12、EMA26，DIF=EMA12−EMA26，DEA=EMA9(DIF)，柱值=2×(DIF−DEA)。EMA首个可用收盘价初始化，初始DIF/DEA为0。检查 `warmup_bars`、`warmup_target=250` 与 `seed_sensitive`；分钟历史上限使预热经常不足，不隐藏这一点。返回点数量与请求数量不同需披露
- `get_auction`：`symbol`。东方财富延迟端点09:15–09:30区间分钟观察点；不是全量集合竞价流。`final_match_price`、未匹配买卖量、撤单量可能全部null，`full_auction_feed=false`；没有点也是合法的缺失结果。可能09:26记录竞价相关观察值而非真正成交发生时间，不能改变时间标签或认证最终撮合价

- `get_archive`：云端仅保留名字/schema，返回 available=false、data_status=unsupported、PUBLIC_PROFILE_LOCAL_REQUIRED、local_required=true；零环境/数据库/密钥/来源读取，不返回云归档。只有获授权且具有开放 NodeSQLite 工厂能力的 127.0.0.1 本地入口可按该参数读取已完成观察：`symbol`、`source`（tencent/sina）、`interval`（intraday/1m/5m/1d/1w/1mo）必填；`adjustment`默认none，分钟/分时仅none；`limit`默认120最大600；`before`使用本地上页的`archive.next_before`，为排他的+08:00源时间游标。该本地操作无上游补抓或后台采集，按来源/复权隔离且窗口升序；`archive.full_history=false`、`total_observed_records`仅指观察记录数，`provenance.first_fetched_at`/`last_fetched_at`保留原始/最近收取时间，`revision_count`统计载荷变更而非保存全部旧修订，顶层`fetched_at`是本次本地读取时间。缺口和存储失败如实披露；源码不带真实数据库
- `get_market_context`：无参数。六个固定宽基为上证指数、深证成指、创业板指、沪深300、中证500、中证1000；指数价格/涨跌点数用点，涨跌幅用百分比，无个股五档或猜测成交量。各指数独立返回源时间、接收时间、新鲜度或错误。`industry_context`优先东方财富行业涨跌前后10名；两侧均不可用才整套回退新浪行业分类（本次验证49类，实际数量看返回），不拼接来源。东方财富是行业指数，可能有嵌套分类；新浪`change_percent`为来源行业平均涨跌幅，`index_points=null`，不是个股代理或东方财富指数。行业`source_timestamp`/`session_date`不可确认、时效unknown；东方财富`provider_date_label`的有效会话含义未经验证。不能称实时排行；上下榜非原子快照，也不证明全市场宽度、历史排名或个股行业归属
- `get_stock_context`：必填`symbol`，沿用A股代码校验。仅当当前工具已可见且实际成功调用时使用。`membership`含新浪分类码/名称、来源页面与分类链接、抓取时间，归属生效日/源时间均null；其分类可能含旧分类或主题，不能换成SW/CSRC/东方财富行业。同分类代码与名称精确匹配才返回`sector_context`，含来源平均涨跌幅和单一完整有效49类响应内的竞争排名（并列同名次）；分类数改变则`rank_descending=null`，不保证经济行业全覆盖。分别检查`errors.membership`和`errors.sector_context`，`available=false`不能冒称完整成功。抓取时间不证明分类或涨跌幅实时；两路请求非原子，不算个股减板块收益。`history.available=false`/空bars代表尚无此精确分类的已验证历史，禁止替代拼接。`security_status`未知，不能由归属推断可交易性
- `get_diagnostics`：可选 symbol；只返回公开 service/schema、日历/市场状态与当前实例公开请求观察。没有环境、数据库、凭据或来源探测；不提供旧账号 health/series，不证明实时源健康、后台监控或跨日可靠性
- `get_stock_directory`、`get_auction_snapshot`、`get_auction_series`、`get_archive`：云端保留旧名字/schema 的四个 unsupported 占位，available=false、data_status=unsupported、code=PUBLIC_PROFILE_LOCAL_REQUIRED；零环境/数据库/密钥/来源读取。不可用不是成功空数据，不能由配置或诊断恢复
- `get_mainboard_universe`：仅接受闭合空对象，读取固定 SSE/SZSE 公开主板目录；范围是沪深普通主板并按 ST/*ST 显示名前缀排除。来源、日期、hash、coverage 与失败需按 [固定主板目录契约](../../ashare-swing-screen/references/screen-contract.md#固定主板目录-get_mainboard_universe) 检查，不认证全 A 股、官方 ST、历史成员或可成交
- `get_swing_screen`：云端仅支持 explicit、1–20 个公开代码和固定 swing-daily-v1；不接受 original_watchlist、after、thresholds 或私有条件。详见 [筛选输入](../../ashare-swing-screen/references/screen-contract.md#get_swing_screen-输入)

## 盘后完成与留存边界

本文件描述 1.27.0-public.2 / public-no-credentials-v2 的当前能力，配套技能源码变体 1.9.29-public.2。14 个保留名字不代表私有版本全部功能或参数：get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 四个云端兼容工具 unsupported，诊断为被动，云筛选仅显式公开代码的固定预设。正式安装技能和另一部署未因这份源码改写而升级或改变。

### 日线、周月与MACD完成证据

- 腾讯none/qfq/hfq历史及新浪日线统一使用2026已核交易日历和Asia/Shanghai严格晚于15:30:03的保守门槛。冻结请求开始时刻为completion_cutoff，解析与freshness沿用该时刻；fetched_at是接收时间，不能替代cutoff或源更新时间。请求开始恰好15:30:03、之前或盘中即使返回跨过门槛，也不升级当日记录
- get_swing_screen目标为该冻结时刻最新已完成预定会话，rules.version=swing-daily-v1、rules.eligibility_version=verified-postclose-v2。保留腾讯qfq、200请求、至少65根有效完整日线、最近65会话无缺口、身份/值/来源与非缓存检查。当日只有门槛后新请求拿到目标日有效行并满足上述检查才可入样；目标日缺失/陈旧/日历未知仍insufficient_data，不必一律排除收盘后的当日，也不能把盘中快照自动认证为最终日线
- calendar_completion=true/false/null表示日历推定证据，source_finality=unknown始终保留。该门槛不认证源最终修订、全交易阶段聚合、临时停市、个股停复牌或可成交；source_timestamp是周期日期标签而非最后成交/源更新时刻
- 周/月须等该周期最后预定交易日同一缓冲门槛后才推定完成；形成中的条形与最近已完成周期分开。104周或60月不因条数够而获全历史认证。日历覆盖外或跨覆盖边界的旧记录可能complete=true、calendar_completion=null、completion_basis=elapsed_calendar_period_unverified_exchange_calendar，只表示已过自然周期；严格条件消费者保留unknown/insufficient_data，不把它升级为已核历史
- 日/周/月get_macd继承基础bars的冻结completion_cutoff、source_finality与每点complete/calendar_completion/completion_basis/period_end_session/observed_latest证据；分钟点只保留实际提供的完成证据，不补造不存在的日历字段。保留预热与种子敏感提示；不能用响应结束时刻重判、让未完成点参与收盘确认。历史金额缺失保持amount_cny=null

### 公开云端无行情数据库读写

公开 get_bars/get_intraday/get_auction、报价、MACD 和背景路径已移除行情数据库读写、本地留存 opt-in 和持久快照回退；即使存在 D1 绑定，也不读取既有行情记录。官方公共目录仅保留有界 isolate 内存缓存，请求观察仅为暂存。默认 db/schema.ts 为空导出，云 SQL 不建表、不迁移、不删表；云构建无 SQL writer、行情 schema 或 portable 存储依赖。SOURCE_RETENTION_PERMISSION_UNVERIFIED、policy=cloud_no_new_market_data_persistence、saved=false/persisted=false 是存储边界，不表示零成交或源必定失败。留存/再分发许可存疑的行情只在获授权本地保存，不写 Git/云文件或云端长期归档。

get_archive 在公开云端为第四个 unsupported / PUBLIC_PROFILE_LOCAL_REQUIRED 占位，不读取 DB、凭据或来源，不返回云归档。四个 unsupported 工具均不读取账号竞价样本/health；凭据、桥接和云端私人自选路由在读取请求体前返回 HTTP 501。源码不带真实档案，公开设置无密钥表单、连接测试或采集控制；被移除的凭据实现及操作流程没有恢复入口。

手工观察/归档/快照回退/自选逻辑只在仓库 portable/local-market.mjs、portable/local-watchlist.mjs、portable/local-observation-store.mjs，由显式 127.0.0.1 Node 宿主提供。每次存储操作要求 portable/sqlite.mjs 的 Node DatabaseSync 工厂签发不可变、仍打开的能力；通用 D1、任意 env、客户端 JSON/header/URL 标记、null origin 及已关闭实例均不能授予能力，云 Worker/bundle 不能导入这些本地模块。本地归档保留原收取时钟与非实时标签，分页不证明历史完整；本地快照回退不构成云回退。此次源码交付未启动实际本地服务，也不变更另一部署、凭据或已有数据。

### 本地数据准备与未完成模块

portable OHLCV 更新器/store 仅准备代码，未导入 Site、未接 portable 路由、真实 loader、连续更新或盘后调度，未完成真实股票池更新。准备数据键仅腾讯 1d:none、1w:none、1mo:none、1d:qfq；qfq 周/月及 hfq 不在该准备集。amount=null，point_in_time=false、source_finality=unknown；ready 仅表示同股四窗口通过保存检查，不代表历史完整、可成交或策略通过。

本地代次保留 dataset_id/content_hash、source/interval/adjustment、target_session、calendar_version/policy_version、request_started_at/completion_cutoff/fetched_at/source_timestamp 与逐条质量。coverage 对账为 eligible = ready + partial + pending_source + failed_without_data + pending；目录数量不是行情齐备数。缺序列或有效样本时返回 unknown/insufficient_data。私人规则读单一冻结代次并只本地重算，改条件不重抓行情；私人密钥、名单、参数和结果不进云工具/Git/包。

条件模块 0.1.3 提供已集成的纯合成页面：10 条虚构池记录及合成 OHLCV，规则只在浏览器内存评估/本地下载，CSP 禁止网络。它没有真实行业龙头池、loader 或完成更新，不能称真实条件选股、回测或盈利验收。云端正式筛选仍是固定 swing-daily-v1。

### 目录失败与安全诊断

公共官方目录可能遭遇访问拒绝，包括 PUBLIC_DIRECTORY_HTTP_403。已有安全字段提供固定 source ID、有限整数 HTTP status、原请求/失败时间、cache/outbound 计数与当前版本/schema；不含原始正文、header、query URL 或任意错误串。冷却读取保留原失败时钟且无额外请求，served_at 不是失败时刻。

元数据改善、旧来源成功、构建或部署记录均不能证明当前来源恢复。失败 coverage=null 不是零池/零候选；不能以被移除的旧目录或凭据路线替代。文档/源码验收只使用离线合成证据，不为核对而探测来源或恢复旧功能。

## 涨跌停来源证据

腾讯沪深报价的47/48位置分别为来源涨停/跌停价；数据层已对照供应商前端映射验证（[腾讯前端字段映射](https://wzq.gtimg.com/resources/web-quota-page/SuperData_v20260825.js)），但只使用数据层本次返回的`provider_price_limits`与`security_status`，不在分析层自行解析。仅与同一选中腾讯报价快照比较；源时间可能陈旧。`provider_fields_verified=true`不把`verified=false`升级为交易所核实；`price_limit_status`只表达该快照价格关系，不证明封单、可成交性或有效监管规则。北交所/新浪限价及所有停复牌状态保持unknown；不得按板块统一推算。

## 竞价覆盖与拒绝项

`auction_quality.phases`分early_observations（09:15–09:19）、late_observations（09:20–09:24）、post_auction_reports（09:25–09:30）。`missing_elapsed_minute_labels`只是截至当前已过去的源分钟标签缺口，非缺单量；`same_day`核对会话。未来、倒序/重复、跨会话、负量额或OHLC矛盾的观察值由数据层拒绝；不能重新引入或自行修复来凑完整。即使16个标签齐全，`full_auction_feed`与`final_match_price_verified`仍为false；虚拟匹配量、未匹配量、最终撮合与撤单仍缺失。分钟量非虚拟撮合量；09:26可能是延后报告标签，不得改写为已验证09:25成交。

## 用户图表与派生估算的解释边界

解读用户提供的竞价/分时图时，另核软件及版本、光标选中时点、坐标尺度和字段定义。点的疏密可能来自采样、刷新或绘图，不能计作参与人数；首个可见量柱不自动证明隔夜委托。显示量减少可能涉及参考价变化、匹配重算或显示口径；没有事件级证据不能定量认作撤单，更不能据此识别交易者。不同软件的量比先核分子、分母、时间归一及更新时间，不用少数截图拟定固定换算倍数。若供应商定义为当日累计量÷（历史平均每分钟量×累计开市分钟），它测累计平均成交速度相对历史基准的比例，不是最新一分钟量或昨日全天成交量的倍数；量比下降不能单独证明即时缩量或资金净流出。核清历史基准与竞价、午休、停牌的会话计时；当前定义不能用来复原算法尚未认证的旧图。

筹码估算须另核供应商算法与版本、价格分箱、衰减/换手设置和股本口径；算法不公开时保持未知。模型中某成本区间覆盖的数量比例不是该区间的股东人数比例，前十大持股占总股本与占流通股比例不可混用。采用股东披露作模型输入时保留报告期和实际披露时点；参数敏感性、事后调参与成交分布不等于现存持仓成本的检查复用[验证流程](../../ashare-strategy-validation/references/validation-protocol.md)，不另设筹码信号或工具。

## 龙虎榜披露与账户信息

仅在用户问题涉及且已有可读的官方披露时，核对交易所、证券、单日/异常期间、买卖金额及单位、披露时间和覆盖条件。营业部或交易单元的区间金额不是完整账户持仓；民间昵称映射不能确认个人身份。买入金额大不证明账户仓位高，零卖出不证明首次建仓，未上榜不证明未参与；开收盘价中点不能推得特定账户建仓均价或亏损底线。缺披露就列为数据缺口，不从量价补造榜单或新增接口。披露阈值须按[来源与A股验证门槛](../../ashare-strategy-validation/references/evidence-and-ashare-gates.md)核其日期和适用证券；用于历史研究时沿用既有可得时点要求，不能把后来公布的榜单倒填盘中。

## 时间和质量

所有中国交易时点按 Asia/Shanghai（UTC+8）解释；接收时间通常为 UTC，两者不得混淆。历史日/周/月K线的源时间可能是源日期加15:00的标签，不是最后一笔成交时间。历史 K 线的 age/freshness 不等同实时报价时效；上一已完成周期本来可能较旧，不因此伪造新日期，也不把旧报价说成实时。

本公开数据层使用已核对的2026年交易所公告日历（2026-01-01至2026-12-31），日/周/月须冻结请求开始时刻严格晚于周期最后预定交易日15:30:03才推定完成。calendar_completion与source_finality分别核对；日历覆盖外或跨覆盖边界的旧complete=true仅已过自然周期展示，未认证完整。临时停市、个股停复牌与源最终修订未核实；未完成周期可按实际schema显式请求并单列，不用于收盘确认。分钟结束标签另有安全缓冲，少一根不表示停牌。

腾讯部分市场股数从手转换且可能取整；来源降级、复权警告、异常价、错误或null均保留。不同接口时间不同、源不同、覆盖不同要解释，不用平均数消除差异。不输出数据层未提供或未经计算验证的量比、换手、成交额、资金净流、筹码分布、撤单率。

## 取数顺序

完整分析可按股票分别请求报价、分时、日周月K线、所需周期MACD与竞价；独立只读请求可并行。先取合理窗口（如120条），只有实际分析需要才增大；没有保证足够预热时应披露而非重复无效请求。仅对用户请求范围内且契约明确允许的暂时性公开源失败，才作有界处理；授权/访问拒绝/业务/结构错误立即停止，不能自动换源或恢复被移除能力。重试仍失败时展示已取到的数据与缺口，不把另一周期冒充缺失周期。禁止为了补全承诺而编造或合成真实行情。


## 已移除能力的非操作性边界

旧专有账号竞价、过程留存、凭据桥接和采集操作说明不属于此公开源码，已删除。get_stock_directory、get_auction_snapshot、get_auction_series、get_archive 四个云端兼容工具名只返回 unsupported，不读取账号/密钥/数据库或来源；被动诊断不包含可执行的专有探测。公开保留的竞价来源只有东方财富延迟盘前观察，其缺口、源时钟、单位和非完整性仍按上述契约解释。不存在配置密钥、桥连接测试、启动采集或历史回补流程。

## 当前名称查询契约

只在实际工具 schema 与结果支持时使用；名称建议不是完整证券目录或可交易证明。

- `get_quotes` 沿用 `symbols`（1–20 个字符串），可接受严格 A 股代码或完整中文证券名称，不新增工具名。名称只经固定腾讯建议源解析；规范化包括 NFKC、ASCII 大小写及空白，ST/\*ST、A/B 与标点仍影响身份。只有唯一精确规范化名称和有效规范代码同时成立才能继续；搜索建议不是完整证券目录、上市状态或可交易性证明
- 名称解析结果见 `name_resolution.items`，条目 `kind=code/name`、`status=resolved/unresolved`，成功时含规范 `symbol` 与可能的 `matched_name`；无名称查询的代码批次可不带该元数据。`status=resolved` 仅证明名称解析，报价仍可能 `QUOTE_UNAVAILABLE`，不能将解析成功当取价成功。未解决查询在 `quotes` 中有逐项错误及候选；混合请求需分别报告成功与失败。`STOCK_NAME_NOT_FOUND` 为无精确匹配，`STOCK_NAME_AMBIGUOUS` 为身份有歧义，`STOCK_SEARCH_TRUNCATED` 为建议响应截断，`STOCK_SEARCH_UNAVAILABLE` / `NAME_RESOLUTION_TIMEOUT` 为查询不可用/超时；上述均不能选第一候选或继续取猜测代码。报价返回名称还须与解析名称相符；`STOCK_NAME_QUOTE_MISMATCH` 会抑制价格，不能绕开该检查。只有解析成功后才把规范代码用于其他仍仅收代码的工具


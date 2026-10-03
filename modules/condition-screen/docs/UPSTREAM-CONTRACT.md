# 父工程提供的 local OHLCV dataset v1 参考

本文件记录2026-10-03父任务明确传递的合同，无来源请求。完整合成参考保存于 `tests/fixtures/local-ohlcv-synthetic.json`，只有虚构行情与时钟；其中tencent源身份仅用于合同映射测试，绝不声称真实收据。本仓库的 [local OHLCV 合同](../../../docs/local-ohlcv-dataset-contract.md) 描述当前准备内核；样例只作合成接口检查。

当前 1.27.0-public.2 / public-no-credentials-v2 的准备内核为 `portable/ohlcv-updater.mjs` 和显式打开的 SQLite `portable/ohlcv-store.mjs`。二者未被云 Worker 导入，未接入 portable server、timer、source、MCP 动作或后台任务。真实本地 loader、更新路由及连续/盘后调度仍未接入，不能由此文档推断更新内核已启动或健康。真实行情不发布到 Git，云 Worker 不读写行情数据库。

另有显式 127.0.0.1 Node 宿主的手工观察/归档/快照回退/自选路径，仅在 portable/local-market.mjs、portable/local-watchlist.mjs、portable/local-observation-store.mjs，要求 portable/sqlite.mjs 的 Node DatabaseSync 工厂签发不可变、仍打开的能力。D1、任意 env、JSON 标记及关闭实例均被拒绝；云 bundle 不能导入这些本地存储模块。默认云 schema/SQL 不建表、不迁移、不删表，云端 get_archive 是第四个 unsupported 兼容占位。该手工路径不接通本模块的真实 OHLCV 消费，也不启动更新器或 schedule；此次源码交付未启动实际本地服务。

`createLocalOHLCVUpdater({runtime:'local',store,loadSeries,now})`须调用方提供loader/store；方法prepare/advance/status/pause/readDataset。无私人策略输入，不读凭据、私有自选或持仓。

已有序列：1d:none请求200、1w:none请求104、1mo:none请求60、1d:qfq请求200。源身份tencent；价格CNY，成交量为provider reported unadjusted shares，amount缺失null。qfq周/月和hfq不在准备数据内。

prepare输入`{items:[{symbol,name}],manifest_hash,target_session?}`，冻结sorted公共主板池、排除ST名称、预期完成交易日、calendar/policy version；不同target生成不同run。禁止free-form strategy/owner/URL/key/extra manifest。ST名称过滤不是官方身份或历史成分股证明。

readDataset(run_id,symbol,series_key)返回`{available,state,dataset,source_finality:'unknown'}`；只有完整提交股票bundle才available=true。失败、部分股票和未尝试状态明确保留。

dataset字段：dataset_id/symbol/source/interval/adjustment/target_session/calendar_version/policy_version/content_hash；request_started_at/completion_cutoff/fetched_at/source_timestamp（provider period label，并非source更新时间）；bars/coverage/units；source_finality unknown、point_in_time false、cache.used true/scope explicit_local_dataset。

父任务后续确认：portable v1在validateOHLCVSeries把completion_cutoff和request_started_at均写为iso(started_at)，advance每序列传入独立requestStart。因此两字段必须表示同一绝对时刻；fetched_at不早于request。D/W/M各自request/receipt可不同，不能要求四系列时钟一致。

bar白名单：date/source_timestamp/open/high/low/close/volume_shares/amount_cny:null/complete/calendar_completion:true|false|null/completion_basis/period_end_session/observed_latest:true|false|null/source_finality unknown。

complete为旧的自然过去周期图表兼容字段；必须看calendar_completion与completion_basis，不能将elapsed past自动认证成完整历史。现W/M可能形成中（complete=false），即使bundle ready。观察标签达到target日不证明底层周期全量或最终修订。交易日历只验证2026。

coverage含requested/returned/first-last date/full_history:false/calendar-unverified rows。available不证明策略窗口够长；缺行或不同basis须unknown/insufficient_data。每次私人规则评估使用一次冻结代，改条件不抓行情。

父任务最终小修另外增加coverage三字段：`missing_scheduled_session_dates`日期数组、`calendar_gaps_unverified`boolean、`missing_session_note`解释。缺日不是feed failure的证据：上市期、停牌、provider覆盖都可能说明缺日。本模块保留这些字段并据窗口返回unknown，不推断原因。当前保存的fixture是同语义的格式化副本，不声称与父原文件字节/哈希完全相同。


上游状态满足eligible=ready+partial+pending_source+failed_without_data+pending。ready表示四个观察窗口保存并通过identity/value/target检查，不表示可交易或符合策略。

advance最多20股、80 loader请求、3并发来源、24秒启动预算、每来源6.5秒超时；durable fence阻止过期/暂停/被替代writer。保留partial尝试、可显式retry failed。均为代码限制，不是全池时效承诺或已启用schedule。本模块不重复实现或启动它们。


父任务另确认store接口：`read(run_id,{symbols:[最多20股]})`只读取本批payload；`status`用于元数据/entries账本；`readDataset`仍是单股单key消费入口。本模块新ledger与这些读取方式衔接，不实现第二个数据库/采集器。默认股票池已收窄为有版本和来源说明的行业龙头明确symbol子池，其研究由另一任务提供，未在本环境接入。

父最新小池prepare兼容合同：旧items/manifest_hash不变，新增directory_identity_hash作为目录身份hash的显式别名；可选curated_universe={kind:'industry_leaders',version,pool_hash,evidence_revision,status:'candidate'|'reviewed'}，pool_hash由排序去重symbol/name计算。prepare(input,{directory})仅消费本地已导入目录，coverage分母为冻结items.length，目录总数只作身份背景。本消费模块不改变prepare、不计算真实名单，宿主可把显式version映射为directory.universeVersion并把可追溯说明映射为sourceNotes；未提供时不生成真实池。此版UI不展示/解析可选curated_universe内部状态，reviewed不能当作官方非ST或交易资格，身份/停牌证据仍须单独检查。

# Public mainboard screening and workbench · 1.27.0-public.2

This is the current contract for `public-no-credentials-v2`, a reduced source profile of the same project. The running private service and installed formal skills are separate versions. See the [public distribution profile](public-distribution-profile.md), [directory capability](stock-directory-contract.md) and [postclose/retention boundary](market-retention-and-postclose.md).

The public source retains manual credential-free quote/bar/intraday/MACD, Eastmoney delayed premarket observations, market/stock context and official-mainboard directory reads. Of the 14 retained cloud MCP names, `get_stock_directory`, `get_auction_snapshot`, `get_auction_series` and `get_archive` are four unsupported compatibility stubs with `PUBLIC_PROFILE_LOCAL_REQUIRED`; they perform no environment/database/key/source reads or writes. `get_diagnostics` is passive. The cloud swing schema accepts explicit codes and the fixed public preset only. Provider/Access credential hosting, bridge transports and collector execution have been removed; no settings or connection-test flow can enable them.

## Credential-free official-mainboard directory

`get_mainboard_universe({})` has a closed empty-object schema. It receives no environment, database, account identity, personal key or private strategy. Hosted access authentication, where required, is separate from market-provider credentials.

A cold refresh runs three fixed public GETs in parallel:

1. SSE current mainboard A-share JSON: `https://query.sse.com.cn/sseQuery/commonQuery.do`, fixed first-page size 2000 and official mainboard/A-share filters
2. SZSE mainboard workbook: [public XLSX source](https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1&selectModule=main)
3. SZSE first-page metadata: [public JSON source](https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=1&selectModule=main)

Requests omit credentials and reject redirects. Each source is bounded to 20 seconds and the combined retrieval to 25 seconds; response bounds are 3 MiB for SSE JSON, 2 MiB for XLSX and 256 KiB for metadata. There is no automatic pagination, retry, host substitution or paid-feed fallback. All three responses must validate and reconcile before a usable pool exists; partial success is not a combined empty or complete result.

SSE identities must agree between result and page metadata, carry official A-share/mainboard labels, and reconcile returned count with total on one page within 2000 rows. Growth beyond the bound fails explicitly. SZSE requires the exact A股列表 sheet, mainboard labels, unique six-digit string A股代码, A股简称 and valid listing dates from unambiguous headers. Workbook count and first-page identity/name/date must agree with metadata.

The original dependency-free XLSX parser uses native `DecompressionStream('deflate-raw')`, documented in [Cloudflare's Web Standards reference](https://developers.cloudflare.com/workers/runtime-apis/web-standards/). It validates ZIP paths/headers/descriptors, CRC, compression and sizes and rejects unsafe or ambiguous ZIP/XML/workbook features. Limits include 16 MiB expanded content, 200000 cells, 100000 shared strings and 10001 rows. Unsupported workbook/runtime formats fail explicitly. This public directory parser does not provide a Cloudflare bridge or collector.

## Classification, clocks and coverage

The fixed ordinary-mainboard classifier uses:

- SH600/601/603/605
- SZ000001–004999 within supported syntax, excluding 001001–001199 mainboard CDRs; original 002 SME codes included
- NFKC-normalized, trimmed, case-insensitive leading ST/*ST display names excluded; original names preserved
- Mutually exclusive unsupported, other-board, unclassified, ST-name-excluded and eligible buckets

Name filtering is not official risk-warning status. Listing, suspension, historical membership and tradability remain unknown. Separate source fetches are non-atomic.

The usable response includes `available/data_status/read_only/scope`, eligible `items`, SHA-256 `manifest_hash`, fixed `swing-daily-v1` defaults, `expected_session_date`, source provenance, coverage and service metadata:

- `source=sse_szse_public`; `universe_version=manifest_version=mainboard-public-directory-v1`; `directory_version=sse-szse-public-v1`
- `credential_required=false`, `credential_reads=false`, `cloud_bridge_requests=false`
- `source_timestamp=null`: no certified common source effective timestamp exists
- `snapshot_timestamp` is a local combined-receipt identifier, not membership effective time; `fetched_at` remains the original combined receipt
- `sources` retain independent SSE/SZSE dates and original fetch clocks; missing SSE date remains null and SZSE display date is not certified membership effectivity
- `served_at` describes service time and does not replace source/receipt clocks
- `complete_exchange_universe=false`, `ordering_and_atomicity=not_atomic`

Coverage reconciles `provider_rows = eligible_mainboard_non_st + excluded_st_name + excluded_other_boards + unclassified + unsupported`. Eligible item count and each source breakdown must agree. Current-source counts do not certify historical/full-atomic exchange membership.

The hash binds sorted complete classified public identities, fixed classification rules and source provenance by source ID. Row/source order and fetch/service/receipt/cutoff times do not change it; source display dates can. The transported response omits the heavy complete manifest/classifications, so eligible items alone cannot reproduce that full hash. A hash is an integrity marker, not a source-authenticity or tradability certificate. A retained pure legacy classifier is offline compatibility code with no source access; it is not a directory fallback.

## Public cache and failure

Worker-isolate memory holds only a fully validated public directory snapshot for six hours and the same Shanghai date. Concurrent calls share one refresh; cache hits make no new source requests. Cold isolates may repeat bounded reads. This is neither durable storage nor a background updater. Cloud market queries have no D1 reads, archive reads or durable snapshot fallback; the directory cache does not grant market-payload storage.

Failure opens an isolate-local 60-second cooldown without automatic retry. A prior validated public snapshot may be served only on the same Shanghai receipt date and for at most 24 hours as `stale_fallback`, explicitly non-fresh and preserving original dates, clocks, receipt identifier and hash. Without a permitted prior snapshot, coverage is null and the directory is unavailable. `current_call_started_outbound_requests` distinguishes refresh from cache/cooldown/shared waits.

Use only safe diagnostic codes, fixed source IDs, bounded HTTP status and original request/failure clocks to explain failure. A 403 establishes access rejection, not a credential or quota diagnosis. Metadata improvements and earlier source success do not establish current accessibility. Do not expose raw source bodies/errors or recover removed credential routes.

## Page-scoped fixed screening

An explicit user start obtains the directory under the cache contract and freezes public identities, manifest, latest eligible session and fixed defaults. The page uses `get_swing_screen` in sequential explicit-code batches of at most 20. Market reads retain concurrency 3, per-source 6.5-second bounds and a 24-second start budget. Fixed Tencent qfq daily data require at least 65 valid completed bars and a gap-free verified-calendar sequence. The strict postclose cutoff and source-finality limit are defined in the [retention contract](market-retention-and-postclose.md).

Ledger: `eligible = match + not_match + insufficient_data + failed_without_result + pending`. Valid insufficient-data results stay distinct from request failures. Missing/duplicate/out-of-pool/malformed results do not become fabricated non-matches. All processed means failed-without-result and pending are both zero; insufficient data still cannot be judged. Overextension flags do not remove matches, and an unflagged result is not low-risk certification.

Pause stops new batches after the active request settles. Continue processes pending members; explicit Retry Failed handles only request failures without valid results. No automatic retries, source substitution or rule optimization are performed. Authentication/request errors pause. A changed cutoff, rule/defaults or generation requires an explicit new run rather than combining results.

Physical single-flight survives page lifecycle changes until the active request settles, and stale generations cannot write newer results. Rerun confirmation replaces page-memory results. Closing the page stops further work and does not persist its ledger. Hiding pauses new batches; returning does not restart automatically. Switching between the four views retains an explicitly started run without starting another.

## Workbench and local boundary

Four same-page views provide 行情图表 / 集合竞价 / 波段选股 / 数据设置. Navigation changes visibility/redraw only. Charts retain source, MA/MACD, absence, failure and freshness evidence. Public settings contain no provider/Access credential form, bridge test or collector control. The auction view uses delayed public observations; the two account-auction legacy tools remain unsupported.

Private watchlists and customized rules are local-only. Manual observation/archive/fallback/watchlist operations exist only in the portable local modules, require the immutable open-NodeSQLite capability issued by `portable/sqlite.mjs`, and are served only by the explicit `127.0.0.1` Node host. D1 bindings, arbitrary environment objects, JSON flags and closed instances are rejected. The cloud source and bundle cannot import this storage code; its default schema/SQL create, migrate and drop no tables. No actual local host was started.

The separate prepared OHLCV updater/store has four data keys and bounded local lifecycle primitives, but real loading and continuous/postclose scheduling are not integrated. The condition-screen 0.1.3 editor is synthetic-only with 10 invented pool records. It proves no real leader universe, completed update, real full-pool scan, backtest or investment result.

## Reference and licensing record

Design/contract inspiration only. No third-party repository code was installed, copied or embedded, and no dependency was added:

- Qlib: feature/formula, calendar, membership and point-in-time separation. [Repository](https://github.com/microsoft/qlib), [MIT license](https://github.com/microsoft/qlib/blob/main/LICENSE), [feature definitions](https://github.com/microsoft/qlib/blob/main/qlib/contrib/data/loader.py), [PIT documentation](https://qlib.readthedocs.io/en/latest/advanced/PIT.html)
- AKShare: identity/name/listing fields and provider adapters. [Repository](https://github.com/akfamily/akshare), [MIT license](https://github.com/akfamily/akshare/blob/main/LICENSE), [stock directory source](https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_info.py)
- vn.py: separation of research, execution and descriptive risk reporting. [Repository](https://github.com/vnpy/vnpy), [MIT license](https://github.com/vnpy/vnpy/blob/master/LICENSE), [risk-report implementation](https://github.com/vnpy/vnpy/blob/master/vnpy/alpha/strategy/backtesting.py)
- RQAlpha was not reused. Its [root license](https://github.com/ricequant/rqalpha/blob/master/LICENSE) has commercial-use restrictions; package metadata alone does not authorize copying or reuse of uncertainly licensed source

Reference research was reviewed 2026-10-03; this document preserves that record without claiming a new live check. [SSE legal notice](https://www.sse.com.cn/home/legal/) and [SZSE legal notice](https://www.szse.cn/application/laws/) remain relevant to source use. Public access and software MIT licenses do not grant market-data retention, resale or commercial redistribution rights. No new project license is selected. Fixed MA/volume rules remain unvalidated descriptive research hypotheses, not upstream-project-certified trading signals.

## Verification boundary

Acceptance of this source profile uses offline synthetic fixtures and the public-profile build/test suite. Existing private-release test totals and earlier production observations are not coverage of this reduced source. Offline tests, a build or a schema listing do not prove current source accessibility, signed-in browser behavior, responsive visual quality, completed market coverage or profitability. No credential probe, removed route recovery, production source request or deployment is required to review this document.

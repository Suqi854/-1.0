# Public postclose and retention boundary · 1.27.0-public.2

The `public-no-credentials-v2` source provides explicitly requested transient credential-free public queries. It does not add cloud market-payload archives, provider/Access credential storage, bridge execution or a collection schedule. See the [public distribution profile](public-distribution-profile.md) for current tool availability.

## Completion policy

Tencent none/qfq/hfq and Sina daily observations use the verified 2026 exchange schedule and a request-start cutoff strictly after 15:30:03 Asia/Shanghai. A current-day row is eligible for the fixed daily screen only when a new request begins after that boundary, returns the target-day row and passes identity/value/source/non-cache and 65-session coverage checks. Crossing the clock boundary cannot promote an earlier cached intraday receipt. Parsing, freshness and MACD retain the same frozen cutoff and per-point evidence.

Completion is schedule-inferred. `calendar_completion` is true/false/null, while `source_finality` stays unknown. It does not verify source final revisions, temporary exchange closures, individual suspension or tradability. W/M require the last scheduled session of the period and the same cutoff; forming periods stay separate. Older elapsed-period display may retain `complete:true` with `calendar_completion:null` and an explicit unverified basis. Strict consumers must preserve uncertainty rather than certify full history. Missing historical amount remains null.

## Cloud observations without database access

Cloud `get_bars`, `get_intraday`, public `get_auction`, quote, MACD and context queries contain no market-database read/write helpers, local-retention opt-in or durable fallback. Existing D1 snapshots and archives are not read, even when a binding is present. The official public directory retains only its documented isolate-memory cache; request-local observations are transient. Retention-policy fields such as `SOURCE_RETENTION_PERMISSION_UNVERIFIED`, `saved=false` or `persisted=false` describe the storage boundary, not zero trading or source failure.

`get_archive`, `get_stock_directory`, `get_auction_snapshot` and `get_auction_series` are four unsupported cloud compatibility stubs. They return `available=false`, `data_status=unsupported`, `code=PUBLIC_PROFILE_LOCAL_REQUIRED` and `local_required=true` without environment/database/key/source reads or writes. An unsupported archive is not a successful empty history. The distributed tree contains no runtime database or real market archive.

The former cloud history/archive, snapshot, auction-storage and watchlist modules are removed. The cloud build has no SQL writer, schema or portable-storage dependency. The default `db/schema.ts` is an empty export and the default cloud SQL is a no-op; neither creates, migrates nor drops tables or touches existing databases.

Credential settings, bridge routes and cloud private-watchlist routes return unsupported HTTP 501 without reading their request bodies. Provider/Access readers, credential/collector table creation, authenticated transport and start/stop scheduling have been excluded. `get_diagnostics` returns passive service/schema/calendar metadata and request-local observations only; it performs no environment/database/credential/source probe. No removed feature can be enabled by saving a key or using diagnostics.

This source-only boundary does not change another private deployment or its existing data. Removed credential-backed collector behavior has no documented recovery flow in this distribution.

## Prepared local engine and retention permissions

The [local OHLCV contract](local-ohlcv-dataset-contract.md) describes the prepared updater and explicitly opened store. They provide injected local preparation, bounded advancement, fences/checkpoints and pause/resume semantics. A real loader, portable route and continuous/postclose schedule are not wired in or enabled. Manual public queries do not satisfy a daily-update commitment.

Manual queries and local observation/archive/fallback/watchlist storage are separate from that prepared updater. They exist only in `portable/local-market.mjs`, `portable/local-watchlist.mjs` and `portable/local-observation-store.mjs`, reached through the explicit `127.0.0.1` Node host. Storage requires the immutable capability issued by `portable/sqlite.mjs` for an open Node `DatabaseSync` instance. Generic D1, arbitrary environment objects, client JSON/header/URL flags, null origins and closed instances cannot grant this capability; the cloud Worker and bundle cannot import the local modules. No actual local host was started by this source delivery.

Authorized local archive reads preserve source/receipt clocks and a non-live label; pagination only describes previously observed records, not complete history or background collection. Local snapshot fallback is explicitly labeled and preserves original timestamps; it does not create a cloud fallback. Where market-data retention/redistribution permission remains unverified, permitted long-term observations belong only to an authorized local host. No real data, private key, watchlist, position or strategy belongs in this public tree. Software licensing is separate from upstream-data permission.

Private conditions consume a single frozen local data generation and recompute locally when conditions change. The condition-screen 0.1.3 page currently uses 10 invented pool records and synthetic OHLCV, with browser-memory evaluation/local downloads and network-blocking CSP. It has no real leader pool or completed local data-update integration.

## Directory failure and verification

The official public directory may return access refusal, including `PUBLIC_DIRECTORY_HTTP_403`. Safe diagnostics expose fixed source IDs, bounded HTTP status, original request/failure clocks, cache kind/outbound count and actual version/schema. Raw provider bodies, headers, query URLs and arbitrary error text are excluded. Cooldown reads preserve original failure clocks and issue no extra request. These fields explain a failure; they do not resolve it or certify current source availability.

Current-tree verification uses invented fixtures, mock sources and temporary synthetic local stores. The offline guard prevents network data requests. It does not probe keys, resume collectors, recover removed endpoints or perform real-market backfill. Any later publication is a separate authorized operation; source/build evidence cannot stand in for deployment or a successful live market update.

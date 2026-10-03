# Local OHLCV dataset v1

The 1.27.0-public.2 / `public-no-credentials-v2` engine is prepared in `portable/ohlcv-updater.mjs`; the explicitly opened SQLite store is `portable/ohlcv-store.mjs`. Neither is imported by the cloud Worker or wired to the portable server, a timer, source, MCP action or background job. A real local loader and continuous/postclose operation require later integration and are not enabled by this source. Real market windows are not published to Git or persisted by the cloud Worker.

The explicit `127.0.0.1` Node host has a separate manual-query path for local observations, archive reads, snapshot fallback and private watchlists in `portable/local-market.mjs`, `portable/local-watchlist.mjs` and `portable/local-observation-store.mjs`. Those storage operations require the immutable capability issued by `portable/sqlite.mjs` for an open Node `DatabaseSync` instance; generic D1, arbitrary environment objects, JSON flags and closed instances are rejected. This manual path does not activate the OHLCV updater, a real loader or a schedule. No actual local host was started. The cloud bundle cannot import the portable storage modules, `get_archive` is an unsupported cloud stub, and the default cloud schema/SQL create, migrate and drop no tables.

`createLocalOHLCVUpdater({runtime:'local',store,loadSeries,now})` requires a caller-provided loader and local store. Its methods are `prepare`, `advance`, `status`, `pause` and `readDataset`. It has no private strategy input and does not read credentials, private watchlists or positions.

The four existing series are `1d:none` (200 requested), `1w:none` (104), `1mo:none` (60), `1d:qfq` (200). All use Tencent as an exact source identity, and prices in CNY with provider-reported unadjusted share volume. Amount is absent and remains null. A consumer must derive available fields from actual series keys; qfq week/month and hfq are not part of this prepared dataset.

The original prepare input `{items:[{symbol,name}],manifest_hash,target_session?}` remains supported. Its supplied hash is an opaque legacy identity marker, not proof of directory membership; status labels it `legacy_identity_not_verified`. It freezes the selected sorted pool, never automatically all rows of a directory. A different target creates a different run. No free-form strategy, owner, URL, key or extra manifest field is accepted.

The optional curated-pool input is `{items,manifest_hash,directory_identity_hash,curated_universe,target_session?}`. `manifest_hash` remains the compatibility alias of `directory_identity_hash`, both lowercase SHA-256 strings for the separately imported public mainboard directory manifest. `curated_universe` has exactly:

- `kind:'industry_leaders'`
- `version`: a local pool revision label, 1–80 ASCII letters/digits/period/underscore/hyphen, beginning with a letter or digit
- `pool_hash`: SHA-256 of JSON encoding the selected `{symbol,name}` identities sorted by symbol, computed by `hashOHLCVPool(items)`
- `evidence_revision`: a local evidence revision label with the same allowed form as version; actual evidence is maintained separately by the local host
- `status:'candidate'|'reviewed'`: recorded local research state, without a waiting-for-user status or updater inference about who selected the members

For this mode call `prepare(input,{directory})` (or `createOHLCVManifest(input,{now,directory})`) with the already imported local `get_mainboard_universe` response. It must be available, ready and read-only, use `sse_szse_public`, and carry the current public-directory manifest version. The updater recomputes the complete directory manifest hash, rejects duplicate identities or declared classifications inconsistent with the fixed mainboard classifier, and matches every selected code and exact name to a name-filtered eligible row. No directory fetch, credential lookup or pool selection occurs. A supplied hash proves integrity of that local imported object, not a signed exchange attestation or up-to-date trading status.

Curated identity metadata, status and evidence revision participate in the frozen run hash along with the selected items, session, calendar, policy and series registry. A pool, revision or review-state change requires a different run. The engine does not identify leaders, verify business/scale evidence, assign industries, enforce 2–5 leaders per industry, or select a default pool. These are separately reviewed local research/host responsibilities. No actual leader list, personal preference or private strategy is included in the cloud source or synthetic tests.

Status includes `universe:{scope,curated_universe,directory_identity_hash,directory_identity,identity_validation}`. `directory_identity` reports the imported directory's `provider_rows` and `eligible_mainboard_non_st`, the selected pool's `selected_identity_matches`, `official_st_status:'unknown'`, `historical_membership:'unknown'`, and `leader_evidence_verified_by_updater:false`. These directory counts are separate from dataset coverage. They do not certify current or historical exchange membership or a completed full-market data run.

`readDataset(run_id,symbol,series_key)` returns `{available,state,dataset,source_finality:'unknown'}`. Only a fully committed stock bundle exposes `available:true`. Failures, partial stocks and not-yet-attempted stocks stay explicit.

Each dataset has:

- `dataset_id`, `symbol`, `source`, `interval`, `adjustment`, `target_session`, `calendar_version`, `policy_version`, `content_hash`
- `request_started_at`, `completion_cutoff`, `fetched_at`, `source_timestamp` (a provider period label, not source last-update time)
- `bars`, `coverage`, `units`, `source_finality:'unknown'`, `point_in_time:false`, `cache:{used:true,scope:'explicit_local_dataset'}`

Each bar is an allowlisted object: `date`, `source_timestamp`, `open`, `high`, `low`, `close`, `volume_shares`, `amount_cny:null`, `complete`, `calendar_completion:true|false|null`, `completion_basis`, `period_end_session`, `observed_latest:true|false|null`, `source_finality:'unknown'`.

`complete` preserves old elapsed-period chart behavior for older calendar-unverified periods. Consumers must inspect `calendar_completion` and `completion_basis`; they cannot upgrade elapsed past periods to certified complete history. Current W/M can be forming (`complete:false`) even when a stock bundle is ready for reading. Their last observation label must reach the target day; that still does not certify all underlying period data or final revisions. The verified exchange calendar currently covers 2026 only.

`coverage` reports requested and returned rows, first/last date, full_history:false and calendar-unverified rows. An available dataset does not establish a strategy's required lookback: conditions needing more rows or a different basis must return unknown/insufficient_data. Each private condition evaluation must use one dataset generation locally; changing conditions must not fetch market data again.

Status coverage satisfies `eligible = ready + partial + pending_source + failed_without_data + pending`, where `eligible` is exactly the unique frozen `items.length`. It is never a hardcoded total such as3052 and never the imported directory count when evaluating a subset. Ready means the four observation windows were saved for that stock with identity/value/target checks, not that the stock is tradable, a verified leader or matches any strategy. ST filtering is based on names, not official security status or historical membership.

One `advance` processes at most20 stocks,80 loader requests,3 concurrent source operations,24s start budget and6.5s per-source timeout; an internal durable fence stops expired, paused or superseded writers. It preserves partial attempts and supports explicit retry of failed items. These are code limits, not a promised all-market completion time or an enabled schedule.

`test/fixtures/local-ohlcv-synthetic.json` is invented OHLCV for three daily bars and two weekly/monthly bars, solely for interface tests. It does not assert a real stock, source receipt, successful data update, investment result or full historical coverage. It includes one frozen generation and all four keys so condition/UI work can consume the same contract without a network request.

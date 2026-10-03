# Public directory capability · 1.27.0-public.2

This document describes `public-no-credentials-v2`. See the [public distribution profile](public-distribution-profile.md) for the complete capability boundary.

## Unsupported legacy directory name

`get_stock_directory` remains discoverable for name/schema compatibility only. In this public source it returns `available=false`, `data_status=unsupported` and `code=PUBLIC_PROFILE_LOCAL_REQUIRED`. The stub performs no environment, database, credential or source read and makes no provider or bridge request. An unavailable result is not a successful empty directory.

The credential-backed directory implementation, its settings and its execution instructions have been removed from this distribution. Adding a key cannot enable the stub. This public source provides no migration or recovery flow for that implementation; it does not change another installation or its existing data.

## Retained credential-free alternative

`get_mainboard_universe({})` reads the fixed SSE/SZSE public current-mainboard directory sources. Its schema is a closed empty object: it accepts no codes, pagination, thresholds, provider override or personal configuration. Hosted access authentication, where required, is separate from market-provider credentials. The directory reader receives no environment, database, account identity or personal key.

The supported scope is ordinary Shanghai/Shenzhen mainboard A shares after the fixed display-name ST/*ST exclusion. It includes supported original Shenzhen 002 identities and excludes the fixed CDR/other-board ranges. The [mainboard screening contract](mainboard-screening-contract.md) defines classification, bounds, response clocks, cache and coverage. This alternative does not provide a general all-A-share directory, official ST certification, historical membership or verified tradability.

Only a fully validated three-response public retrieval can produce a usable pool. Check `available`, `data_status`, `source=sse_szse_public`, the manifest version/hash, source-specific dates and coverage before using it. Failure has null coverage and must be reported as a directory not obtained; an empty `items` array does not establish zero stocks or zero screening candidates. A cache hit or hash alone does not certify current membership or an atomic market snapshot.

## Downstream use and local limits

A directory read does not run daily screening. User-requested public research may pass frozen public codes in batches of at most 20 to the fixed explicit-code `get_swing_screen` interface. Preserve the requested scope, manifest, cutoff, failures, insufficient data and unprocessed members; do not replace an unavailable mainboard pool with a small sample while claiming full coverage.

Private watchlists, custom thresholds, conditions and results belong to an authorized local execution path. The explicit `127.0.0.1` Node host supports manual queries and local observation/archive/fallback/watchlist operations only with the immutable open-NodeSQLite capability issued by `portable/sqlite.mjs`; D1, arbitrary environment objects, JSON flags and closed instances are rejected. No actual local host was started. The cloud Worker has no market-database reads/writes or durable fallback; `get_archive` is the fourth unsupported cloud compatibility stub, and its default schema/SQL create, migrate and drop no tables.

The separate prepared local OHLCV kernel has no real loader or continuous/postclose schedule wired in. The condition editor uses 10 invented pool records and synthetic OHLCV only. Neither component restores the removed directory tool or proves a real leader pool.

`get_diagnostics` is passive public-profile metadata and request-local observations. It does not probe credentials or sources and cannot recover the unsupported tool. Verification of this source uses offline synthetic inputs; it establishes neither live source accessibility nor a completed market scan.

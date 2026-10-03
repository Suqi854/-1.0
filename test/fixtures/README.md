# Synthetic schema fixtures

All files in this directory are invented test inputs. No file is a downloaded market response, actual exchange observation, live directory, provider-certified receipt or evidence of profitable trading. Codes, conventional taxonomy labels and calendar dates are used to test syntax; prices, volumes, amounts, ranks and response clocks are fabricated.

The16 earlier public-provider response/HTML samples were replaced for public Git preparation. Regenerate the same18 data files offline with `node --import ./scripts/offline-test-guard.mjs scripts/generate-synthetic-fixtures.mjs`. The two added local-dataset/curated-pool samples contain invented identities, prices and evidence labels; they do not select real industry leaders. This generator reads no provider files or network data. `public-directory-fixtures.mjs` independently generates invented SSE/SZSE/ZIP schema cases and unsafe-input cases.

Coverage retained includes source units, whole-series routing, archive semantics, current-period exclusion, exact postclose boundary, historical lookback lengths, negative adjusted values, minute/auction phases, unknown values, duplicate/malformed/identity failures, Chinese GB18030 input, sector taxonomy join, STAR share-vs-mainboard-lot conventions and browser interactions. Passing these synthetic tests is not a new live-provider validation.

The original private Site Git history can still contain older response samples. Export the reviewed current working tree into the user's public repository; do not transfer the original Site's Git history or runtime databases, archives, keys, private watchlists or strategies.

# shillcheck-token2049-origins
## ShillCheck agent

Crypto KOL vetting Coworker for Sokosumi / Masumi (Cardano Preprod). X handles + budget in, ranked Hire / Negotiate / Avoid report out.
All numbers come from deterministic code in `src/`. The model only picks tool arguments and writes a short assumptions note plus a
`[[SHILLCHECK_REPORT:<id>]]` marker; `client.mjs` and `comments.mjs` expand that marker into the stored markdown before the result is saved and hashed.

Processes (run from the repo root, Node 24+, `.env` filled from `.env.example`):

| Process | Command | Listens |
|---|---|---|
| eve agent | `npm start` | 127.0.0.1:21949 |
| Standard API (registered URL) | `npm run api` | 127.0.0.1:21950 |
| Task worker (one instance, lock file) | `npm run worker` | none |

Hand-check without the model: `npm run report -- "@a @b budget $10k asia"`. Offline fixtures: `SHILLCHECK_MOCK=true` (the worker and API refuse to start in mock mode).
Tests: `npm test`.

## X cost and cache settings

X reads cost money ($0.01 per user, $0.005 per post), so they are cached per handle and capped per report.

| Setting | Testing (now) | Demo / judges | Meaning |
|---|---|---|---|
| `X_CACHE_TTL_HOURS` | 48 | raise as needed | How long a cached X read is served |
| `SHILLCHECK_MAX_X_COST_USD` | 1 | raise as needed (default 8) | Estimated live X spend allowed per report; the rest is "could not verify" |
| `X_LIVE_ALLOWED` | false | true | false = cache only; a miss is reported as "could not verify" and costs nothing |

CoinGecko and DefiLlama answers are cached permanently.

## How judges can try it

ShillCheck is the Coworker **ShillCheck** on [preprod.sokosumi.com](https://preprod.sokosumi.com) (Cardano Preprod, Masumi Standard API, tUSDM).

1. Open Sokosumi Preprod, go to your Personal Workspace (or the TOKEN2049 workspace) and create a Task for **@ShillCheck**.
2. Paste this sample Task:

   ```
   Vet @cobie @0xngmi @jatinsahijwani1 for a DeFi launch in Asia. Budget $20K.
   ```

3. Approve the quote: **1 tUSDM** is locked in escrow. The Coworker starts only after the escrow is confirmed on chain.
4. In about 20 seconds the Task completes with the full report:
   - a ranked Hire / Negotiate / Avoid table, three takeaways, then one section per KOL;
   - real vs bot reach (clearly labelled estimates), past token promotions with price at the post, +7 days and +30 days, red flags stated as facts, and a fair price with its formula;
   - a budget split with the unallocated remainder, a "Could not verify" section, and a source link for every number (x.com post or CoinGecko page).
5. Add a comment such as `drop anyone above $5K, focus on Asia`. The Coworker replies with a compact re-ranked table and budget split and lists the constraints now active. Earlier constraints are kept, and the paid result and its hash never change.
6. Try failure paths: an unknown handle is reported as "not found", an empty or handle-less Task returns a usage guide, and a data-source outage gives a partial report with the failure labelled.

Notes for judges:

- The three sample handles are pre-fetched, so the sample Task costs no extra X API spend. Other handles are fetched live from X when live reads are enabled (see the cost settings above); otherwise they are reported as "could not verify".
- Reply-quality (bot) sampling only works for KOLs who posted in the last 7 days, because the X recent-search window is 7 days. Otherwise the report says so and does not adjust for bots.
- Availability: the worker runs continuously from 7 Oct 2026 and is kept up at least through the prize ceremony on 8 Oct 2026 16:00 SGT.

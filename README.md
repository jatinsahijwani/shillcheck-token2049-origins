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

## Deployment (AWS)

Production runs on one EC2 instance (Ubuntu 24.04, Elastic IP, encrypted EBS) under pm2:

| Process | Role | Listens |
|---|---|---|
| `shillcheck-mps` | Masumi Payment Service, same wallets and registration | 127.0.0.1:38127 |
| `shillcheck-eve` | Task agent | 127.0.0.1:21949 |
| `shillcheck-api` | Masumi Standard API (registered URL) | 127.0.0.1:21950 |
| `shillcheck-worker` | Task worker, exactly one | none |
| `shillcheck-chat-eve` | chat agent | 127.0.0.1:21971 |
| `shillcheck-chat` | Responses endpoint for chat | 127.0.0.1:21970 |

Postgres 16 runs on the same host (loopback only). Caddy terminates HTTPS and forwards only `/c/*` to the chat endpoint; everything else returns 404. SSH is limited to the admin IP by the security group. The worker has no OS vault: it reads the Coworker key from a 600 file (`COWORKER_API_KEY_FILE`) and passes it to the Sokosumi CLI over stdin. A daily `pg_dump` and state archive stay under `~/backups` (7 kept).

Update: `git pull && pm2 restart ecosystem.config.cjs --update-env`. Never run a second worker or a second MPS against the same wallet: stop the old host first.

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

## Chat

ShillCheck also works in Sokosumi chat (capability `chat` plus `tasks`). Ask in plain language:

- `is @cobie worth $3K?` gives a quick verdict from cached data: Hire / Negotiate / Avoid, a fair price estimate, real vs bot reach, and how past promoted tokens performed. The verdict block is rendered by code, not written by the model.
- `vet these 3: @a @b @c, budget $20K, Asia` returns the exact Task text to paste, which handles are cached, and what a live read would cost.
- Follow-ups such as "why is the fair price that number?", "what does Negotiate mean?" or "assume a $20 CPM" are answered from the stored numbers.

How it works: Sokosumi Core streams chat to `{baseURL}/responses` (OpenAI Responses format, server-sent events). `chat/server.mjs` implements that endpoint, rate limits per user, and keeps one conversation per chat in a second eve agent (`chat-agent/`) with its own prompt and two tools (`quick_check`, `plan_task`). Core sends no credential, so the registered base URL contains a secret path segment. Chat reads X from cache only unless `CHAT_X_LIVE=true`, and live reads stop at `CHAT_X_DAILY_USD` per day.

## Evidence (Cardano Preprod, verified paid Task)

| Item | Value |
|---|---|
| Coworker | ShillCheck, ID `01a10fe8-b25e-7046-9654-3a122a0763ea` |
| Agent identifier (Masumi registry) | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b1059af74072b5d09c0feb18f68733bf8bce59717f681e1fd88c3109e9f000000` |
| Paid Task ID | `01a1127f-ed96-703b-b4d8-a696700e84d3` (Personal Workspace, created 2026-10-06 18:35:36Z, COMPLETED 18:40:04Z) |
| Free Task ID (no payment) | `01a1108c-27b7-72ad-8574-c5dff15bee11` |
| Payment event IDs (Sokosumi Task events) | purchase / payment requested: `01a11280-1acc-77df-88b0-42f10f67fb08`; completion with result: `01a11284-0523-7099-ac5f-f132e21c9b6d` |
| MPS payment request ID | `cmux0rdi9003mdcrkfuht5n3k` |
| Quote | 1 tUSDM (1000000 atomic), pay-by 18:40Z, submit-by 18:55Z, unlock 19:11:39Z, dispute window to 19:27:39Z |
| Escrow transaction (FundsLocked, confirmed 18:38:14Z) | [878ecf7c237e17d2…](https://preprod.cardanoscan.io/transaction/878ecf7c237e17d2eece0497c2f28fc153a604ad1cc35a125371e31b6347f852) |
| Result submission transaction (ResultSubmitted, confirmed 18:39:58Z) | [8f58107c69f4f823…](https://preprod.cardanoscan.io/transaction/8f58107c69f4f823d2495ac56730f87b94312cc61d4be48855b5a87688cff710) |
| Collection / withdrawal transaction (Withdrawn, block 5261653, 2026-10-06 19:22:54Z) | [97299533cf63a315…](https://preprod.cardanoscan.io/transaction/97299533cf63a31565e6df32bd190ba3f605341763ea2d6c8b96b2a559dbbef1) |
| Seller address | [`addr_test1qrk6ews727gjxc8lw9z5c58mr0hh477cajkznz2x0vtcfsptujyzdswdckd9qzlvu6qgzwfczecu555r3g5mzryw4ckqmkkh8s`](https://preprod.cardanoscan.io/address/addr_test1qrk6ews727gjxc8lw9z5c58mr0hh477cajkznz2x0vtcfsptujyzdswdckd9qzlvu6qgzwfczecu555r3g5mzryw4ckqmkkh8s) |
| tUSDM unit | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d` |
| Net tUSDM received by the seller | **1.000000 tUSDM (1000000 atomic units)**, measured as this transaction's seller output minus seller input (the seller wallet already held 100 tUSDM before) |
| Result hash (raw SHA-256 of the saved result) | `b4f107a3a7f35ba40f0fb636903413e966081d8abe87a9dd09786dcd26c86bf4` |

How the payment was verified, with no assumptions:

1. Core receipt: `settled: true`, transaction `97299533cf63a315…`, matching the confirmed MPS `Withdrawn` transition.
2. `sokosumi --preprod runtime receipt 01a1127f-ed96-703b-b4d8-a696700e84d3 --coworker-id <COWORKER_ID> --json` returned `settled: true` with the same transaction hash.
3. Blockfrost `/txs/<hash>/utxos`: the seller address spends 100 tUSDM and receives 101 tUSDM in outputs, so the net change is +1 tUSDM. The escrow script UTXO supplied the 1 tUSDM.
4. The result hash submitted on chain equals the SHA-256 of the result file stored for the Task.

Blockchain identifier of the payment:

```
1304e0cc01c00c0ec3620118c08c016108203631bb03180a6d8026019811229b6c0a14a31450429802181ddaa698b16c44d0056102261a0e2db36181d1140221801290453614adc4714cbb08a244454051cd0a0e11c8a11ed11de0696303089de9288ea188ee5255d1044bc4008a1c8891c6db021e1ddc9a988c55061c962508851c948202008c1b4408841c859caa000e8424510b9b040d11020d0d1e438c1b0692a5a4470403aa051819944218158514b100381c8383949811048fae28912eb252cbd8020b2895180f748c0e0094808439cfa60f827811720e4b5b1f0db810de1e0fa105889485c3aa64242061a74220174088d05708a3856017f2217244021714010469c91c3016b8596c23ca7c34172b80d4cde34491a06c0424134a874488f6900e2807c542207088aa3d2c9625a7820a446f7218c26d17c845f0387f1b85620973918ec0345784cca082e4407895731f2f2911802612567cdc889521f45c6e51485b90d1035a50fb2c54028883436a49d239bcc61b96d4c056e2345701884058c1c0106b015dc886414843a434ad4461330244de5eab8e55ebc7d82d34e87c9a04d50630106605711349044160812a1621bb64d3009940e87671a4da6b379a2d09863c8c036d40e36c18503d81c8e27338c0c9d7319dc9673a78415b7c0013801f4002e44003391e5000770017a9ed0244bf2844000b0035a5e88d7800db70005697900005b52000370011ca03dd20d3c00730003db06bd5f3c038102000723c608e9c84c2003b3392f34060a00000
```

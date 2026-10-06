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

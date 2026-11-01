# Career Observatory Text-to-SQL MVP

The Cloudflare edition executes model-selected queries on D1. The browser still
loads the public snapshot for the original charts, offline export, CSV imports
and deterministic rule queries. Model research uses the server's active dataset;
it never accepts browser-computed statistics as authoritative tool results.

## Run locally

Requires Node.js 24 or newer (the local importer uses `node:sqlite`).

```sh
npm ci
npm run data:import:local
npm run dev:research
```

Open `http://127.0.0.1:8788/#assistant`. Rule queries need no model key. Set
`DEEPSEEK_API_KEY` in the process environment, or configure a personal key in the
assistant, to use real model research. No valid model credential is committed.
The connection-test endpoint sends a short real request; passing simulated-model
tests does not establish provider availability.

`dev:research` serves the actual API handler against local SQLite. Native
workerd/D1 SQL compatibility has a separate integration test. The original
Vinext build remains supported through `app/api/research/[action]/route.ts`.
`workers/research.mjs` and `wrangler.research.jsonc` provide a direct Worker plus static
assets deployment of the same application and handler.

## Runtime flow

1. `status` checks the active dataset, normalization version, session table and
   query view. A configured secret is reported separately from data readiness.
2. `start` validates the requested dataset and filters, reads the previous
   cookie-owned turn if supplied, and freezes its inherited scope.
3. DeepSeek receives the business rules, restricted schema and tools. Its
   `sql_query`, `query`, `compare`, `catalog` and `evidence` calls execute inside
   the Worker. Tool errors are returned for correction; database errors fail the
   request rather than becoming zero records.
4. The server returns the answer and computed evidence cards in one response.
5. `page` reads the original result's scope from its cookie-owned turn and
   returns the next eight jobs in source order. It freezes the original cutoff
   date, so crossing midnight cannot change pagination membership.

Session payloads expire after an hour. Browser history is independent and
persists locally. Restored filters and SQL are validated again. Restoring a chat
does not revive expired server pagination; the user must requery. Switching from a model conversation with SQL predicates to local rules starts
a new saved research conversation so SQL conditions cannot silently disappear.

## API contract

All POST endpoints require exact same-origin `Origin` and JSON content type.
Responses use `Cache-Control: no-store`. The cookie is HttpOnly,
SameSite=Strict and Secure on HTTPS. The dataset version is checked by the
server; source metadata and statistics are not supplied by the browser.

| Endpoint                   | Request                                                                                         | Response                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/research/status` | —                                                                                               | `backend`, `dataReady`, `ready`, `dataset`, `reason`                                  |
| `POST /api/research/test`  | optional personal `modelConfig`                                                                 | real provider connection result                                                       |
| `POST /api/research/start` | `question`, `dataset`, `context.filters`, optional `previous`, `modelConfig`, `referenceOffset` | `turn`, `status: done`, `answer`, `requestId`, `dataset`, `effectiveScope`, `results` |
| `POST /api/research/query` | `dataset`, optional `context`, either `filters` or `sql/params`                                 | deterministic server result and turn, no model needed                                 |
| `POST /api/research/page`  | `dataset`, `turn`, `ref`, numeric `cursor` returned by query                                    | `jobs`, next `cursor` or null                                                         |

`continue` is disabled in the Cloudflare edition. It cannot submit fabricated
browser tool results. The Makers edition explicitly uses the old PostgreSQL
session/browser-tool protocol and reports `backend: legacy-client`.

## SQL grammar and trust boundary

The first version accepts an intentionally small, fully parsed SQL subset:

```sql
SELECT DISTINCT id FROM job_search
WHERE city IN (?, ?) AND occupation = ? AND salary_min >= ?
```

```json
{ "params": ["深圳", "杭州", "1", 5000] }
```

The schema exposed to the model contains city, city group, occupation, title,
company, industry, source, standard education, experience group, work type,
hiring channel, salary bounds/midpoint and publication/update dates.

Allowed predicates are `=`, `>=`, `<=`, `>`, `<`, `LIKE`, `IN`, `IS NULL` and
`IS NOT NULL`, combined by `AND`. `LIKE` is limited to title/company; city
membership permits only `=`/`IN` to avoid incorrect multi-city negation. Every
value uses an anonymous `?` and a validated parameter. The grammar rejects
literals, comments, extra statements, aliases, OR, joins, subqueries, functions,
ORDER BY, LIMIT, aggregation, write statements and access to any other table.

The original model SQL is never executed. `sql-guard.mjs` produces predicate
objects; the query layer emits its own parameterized SQL and injects the active
dataset plus inherited filters. The view can contain several city rows per job,
but the outer query selects jobs once by ID. Salary aggregates operate on this
deduplicated set. An evidence LIMIT never truncates the aggregate population.

Queries have at most 12 SQL predicates, 20 values per IN clause and 90 total
bindings in the final scoped query. Model requests have a 45-second deadline,
six tool calls, four tool rounds and a separate 36-query database budget. These
are per-request fault protections, not daily user quotas. D1 controls the actual
execution limit of each fixed database statement; an abort cannot undo an
already-submitted database read.

Salary range overlap/containment, all-skills matching, exclusions, experience
year parsing, employer-major requirements and empty-condition overrides use the
validated `query` tool. City/occupation comparisons use `compare`. Arbitrary
analyst SQL, joins, general grouping, prediction and real-time recruitment status
are outside this MVP.

## Scope and statistical semantics

Each turn starts from a frozen scope. A SQL predicate replaces the inherited
dimension it mentions. Other dimensions remain. A later query can clear a
dimension with an empty array/string. Tool calls within a single turn do not
mutate the scope of their siblings. The last successful query/compare becomes
the next turn's scope.

The domain functions preserve the original browser behavior:

- China mainland and known-city filters apply by default. The shipped snapshot
  has 69,465 records; its default known-city mainland scope has 53,450.
- Actual cities and the `其他大陆城市` group remain distinct. City groups may
  overlap, and their counts must not be summed as a market total.
- Valid salary requires finite bounds with `0 <= min <= max`. There are 54,415
  such records across the complete snapshot. Statistics use interval midpoints,
  with linear interpolation at `(n-1)*q`.
- Salary statistics are null below 10 valid samples; 10–29 are labelled small
  samples. Missing values remain distinct from zero.
- Standard education and experience groups are derived from source text;
  `hiringTypes` maps to `employmentType`.
- Expiry uses today's UTC+8 date, not the manifest's historical validation
  counts. Publication, update, observation and collection dates stay distinct.
- `headCount` has mixed source types. It remains losslessly available in
  `raw_json`; records are not interpreted as numbers of people hired.

The full JSON for each job is retained. The complete request-source audit stays
in `public/jobs.json`, with its SHA-256 in `datasets`; the compact stored manifest
omits that large `sources` array. This avoids D1's per-row/statement limits.

The maintained Python verifier now reads `public/` and writes its report under
ignored `.textsql/`. The expanded-pool integration script also targets `public/`
instead of a generated build directory. `normalize.py` and
`finalize-business-data.py` are historical embedded-snapshot reconstruction
tools (including old local paths), not the current migration workflow. Do not
use them to rebuild the sharded dataset; use the manifest-based importer above.

## Data and migration files

`db/schema.ts` and generated Drizzle snapshots describe the tables and indexes.
The `job_search` view is a custom SQL addition in `0002_jobs.sql`; preserve it
when changing migrations. Existing `0000`/`0001` migrations are unchanged.

| Table                | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `datasets`           | immutable version, source checksum, normalization version, coverage and taxonomy |
| `active_dataset`     | one atomically selected complete dataset                                         |
| `jobs`               | normalized query fields, source ordinal and complete source JSON                 |
| `job_cities`         | actual city and city-group membership                                            |
| `job_skills`         | exact skill membership                                                           |
| `job_related_majors` | source related-major mapping                                                     |
| `research_turns`     | temporary cookie-owned model messages and result scopes                          |

`scripts/import-jobs.mjs` validates both JSON and gzip bytes, all checksums,
counts, IDs, field types and dates before generating output. It preserves source
order. Local imports and D1 files are idempotent for an immutable version.
Changing normalization requires a new `DOMAIN_VERSION`. A conflicting manifest
under an existing version aborts rather than silently overwriting it.

## Deployment and rollback

1. Confirm the target Cloudflare account, real D1 binding and capacity. Export
   the existing database before a production migration. The repository's
   all-zero database ID is a local placeholder, never a verified production ID.
   Sites-managed `.openai/hosting.json` and a standalone Wrangler deployment are
   separate deployment choices; do not replace a managed binding accidentally.
2. For standalone deployment, set the verified database ID/name in
   `wrangler.research.jsonc`. The import helper expects JSON syntax in that file.
   For an existing Sites-managed database, let that platform apply the new
   Drizzle migrations first, then pass `--skip-migrations` to the import helper.
   Do not replay migrations `0000`/`0001` through a different migration ledger.
   The helper checks table/view readiness before importing in either mode.
3. Generate the full validated import plan, then apply locally:

   ```sh
   npm run data:export:d1
   node scripts/d1-import.mjs --local
   npx wrangler dev --config wrangler.research.jsonc
   ```

4. After reviewing the local result, the remote import is an explicit operation:

   ```sh
   node scripts/d1-import.mjs --remote
   npx wrangler secret put DEEPSEEK_API_KEY --config wrangler.research.jsonc
   npx wrangler deploy --config wrangler.research.jsonc
   ```

   Do not run remote operations against an unverified target. The helper checks
   source/file hashes, applies migrations and stops immediately if any import
   part fails. `activate.sql` runs last and checks job, relationship and salary
   counts before switching the active pointer. It does not switch on a partial
   import. No database or site has been deployed by preparing these files.

5. Verify status, a known query, a city comparison, a follow-up and pagination
   against the deployed URL using a real model credential. Confirm server logs
   do not contain keys or upstream error bodies.

Keep the previous complete dataset and Worker version until acceptance. Roll
back data by updating the singleton `active_dataset.dataset_id` to the prior
verified complete version. Roll back the Worker through the chosen deployment
platform. Leave additive tables intact; do not drop `research_turns`. Do not
roll back to a browser-tool Worker while keeping the new client: deploy a
matching frontend/backend pair. Expired chats must be queried again.

The full local SQLite snapshot measured approximately 391 MiB before staging
another version. Production capacity must accommodate indexes, sessions and
coexisting snapshots; do not assume a free-tier database can keep two versions.
Cloudflare's current limits and import behavior are documented at
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and
[D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Verification

For an existing managed Site without direct D1 CLI access, the maintenance-only
`POST /api/research/import` route accepts structured batches, not arbitrary SQL.
It is disabled unless the owner sets a temporary `JOBS_IMPORT_TOKEN` Secret.
Run `node scripts/prepare-managed-import.mjs` to generate validated metadata and
batches. Send `init`, `batch`, `status`, then `activate` with that bearer token.
Each batch is atomic, conflicting replays abort, and active versions reject
further batches. The final pointer switch checks all record and relationship
counts. Remove the temporary Secret, redeploy, and verify that the route returns
404 after import. Never place this token or the model key in source or logs.

The full native D1 acceptance test is `node test/full-d1.mjs`: it imports all
69,465 records through workerd/D1 and checks the same 25 statistical cases. Its
report is stored in `.textsql/native-d1-report.json`.

```sh
npm test
npm run test:d1
npm run test:data
node qa-research-server.mjs
npx tsc --noEmit
npm run build
npm run worker:check
```

`test:data` requires `data:import:local` first. It evaluates the actual browser
predicate implementations and compares 25 cases against the full SQLite
snapshot, including exact salary quantiles. `test:d1` runs migrations, staged
activation, window statistics, API queries and session pagination on native
workerd/D1 with a 40-record fixture. The provider is simulated in model-loop
tests. Local query timings are not a production performance guarantee.

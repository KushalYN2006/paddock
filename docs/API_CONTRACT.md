# REST API contract proposal

Base path: `/api/v1`. JSON responses. Dates are ISO 8601 UTC instants or local calendar dates as explicitly named. All public responses include a `meta` envelope:

```json
{
  "data": {},
  "meta": {
    "season": 2026,
    "throughRound": 0,
    "updatedAt": null,
    "stale": false,
    "source": "jolpica-f1"
  }
}
```

`throughRound` is the latest round confirmed in local storage, not the current calendar round. `updatedAt` is null until a successful import. `stale: true` means the last scheduled refresh failed or validation found the imported state unsafe to present as current. On errors, return `{ "error": { "code": "...", "message": "...", "details": [] }, "meta": ... }`. Never return HTML errors or silently fall back to stale-as-current data.

## Public routes

| Method and path | Result / behavior |
|---|---|
| `GET /health` | Process health and database connectivity, no secrets |
| `GET /status` | Data freshness, current-through round, last success/failure, source |
| `GET /seasons` | Available seasons, current season, historical read-only indicator |
| `GET /seasons/:year/calendar` | Round, race name, circuit/location, schedule, event status, schedule-change note |
| `GET /seasons/:year/standings/drivers` | Verified standings and points gap; optional `throughRound` |
| `GET /seasons/:year/standings/constructors` | Verified constructor standings; optional `throughRound` |
| `GET /seasons/:year/standings/:kind/history` | Top-five points progression snapshots for `drivers` or `constructors` |
| `GET /seasons/:year/races` | Paginated completed and upcoming race list; default `limit=20`, max 100 |
| `GET /seasons/:year/races/:round` | Race detail and results; only after classified result is stored |
| `GET /seasons/:year/races/:round/analysis` | Supported derived metrics; unavailable metrics explicitly marked |
| `GET /seasons/:year/movers` | Position changes since previous confirmed round |
| `GET /drivers` | Paginated/filterable driver list |
| `GET /drivers/:id?season=:year` | Driver identity, sourced selected-season statistics through the last confirmed round, and explicit career-data availability |
| `GET /drivers/:id/teammate-comparison?season=:year` | Qualifying and race head-to-head counts plus exclusions methodology |
| `GET /teams` | Paginated constructor list |
| `GET /teams/:id` | Team identity, season entries, results and sourced profile fields |
| `GET /seasons/:year/calculator/summary` | Deterministic points gap, remaining event maximum and alive/eliminated state |
| `POST /seasons/:year/calculator/scenario` | Validate scenario assignments and return projected standings; no persistence |
| `GET /seasons/:year/predictions` | Stateless form-and-points estimates only when the rolling back-test passes; otherwise an explicit unavailable state |
| `GET /learn/guide` | Beginner guide sections, season-aware rule content |
| `GET /learn/glossary` | Glossary entries, optional `?id=` |
| `GET /learn/quizzes` | Quiz questions and answer options, without answer key |
| `POST /learn/quizzes/:id/answers` | Check answers and return explanation/score for the submitted attempt |

## Scenario request and validation

```json
{
  "rounds": [{
    "round": 20,
    "raceFinishes": [{ "driverId": "driver-key", "position": 1 }],
    "sprintFinishes": [{ "driverId": "driver-key", "position": 1 }]
  }]
}
```

Reject unknown drivers/rounds, duplicate driver assignments, duplicate positions within a session, positions outside the entrant count, already-completed rounds, sprint assignments on a non-sprint weekend, duplicate rounds, and request sizes above the documented cap. Tied positions may be represented only when explicitly enabled with the regulation's dead-heat semantics. Validation errors use HTTP 422 and field-level details. The response identifies rule-set version and assumptions.

## Pagination, cache, and status

List routes use `limit` and `offset`, return `meta.pagination { limit, offset, total }`, and cap `limit` at 100. Historical immutable data may use `ETag` and long-lived public cache headers. Current-season data has a short cache lifetime and a freshness timestamp. `/status` and error responses are not cached. Provider calls are only made by backend jobs, never by the browser.

### Calculator behavior

The calculator is enabled only for seasons with a verified ruleset; the current implementation supports 2026 FIA Section A, Article A2.2, Issue 02. The summary counts only scheduled events whose start is still in the future. Past scheduled rounds beyond the last confirmed result are reported as unconfirmed and excluded from remaining-points calculations. Maximum remaining points assume a full-distance race and the season's Sprint points where scheduled; the 2026 fastest-lap bonus is zero. An elimination label is definitive only when a driver's mathematical maximum is below the current leader's confirmed points.

Scenario assignments must reference a known driver and an upcoming scheduled round. A driver or finishing position may appear once per session, positions must be between 1 and the season entrant count, sprint results are accepted only on Sprint weekends, and the request may contain at most 30 rounds. Invalid scenarios return HTTP 422. Scenario results are calculated in memory and never stored. Unassigned drivers and sessions add zero points. Projected ties retain current order for display and are explicitly subject to the official season tie-break procedure. Shareable scenarios are encoded in the URL on the client; no user profile or saved scenario is created.

### Predictions v1

`GET /seasons/:year/predictions` returns an estimate only after there are at least 12 rolling checkpoints from completed seasons and the form-and-points blend matches or beats the points-only baseline on both title-leader accuracy and mean absolute final-points error. The estimate blends 60% season points pace with 40% average points scored per round over the latest three confirmed rounds. The response includes the model version, method, season/round horizon, and back-test metrics. It reports estimated final points and order, not percentages or calibrated probabilities. If current form, past-round classifications, or validated back-test history is insufficient, `available` is false with a reason and an empty estimates list. The exact calculator remains separate. Predictions are derived on request and no prediction run or visitor data is persisted.

### Race recaps and analysis

Race detail includes separate Grand Prix and Sprint classifications and only source-linked recap entries. Classification facts (winner, podium, and best grid-to-finish gain when available) are derived from the stored result rows and attributed to Jolpica-F1. Unsourced draft recap entries are withheld; interpretation is displayed separately from fact. The analysis endpoint derives grid-to-finish changes and teammate finishing comparisons from stored classification. Qualifying comparisons are returned only when qualifying data is stored and can be matched to race results. Pit-stop comparisons remain unavailable until pit-stop records have been imported and validated as reliable.

## Admin routes

Admin maintenance is disabled unless the backend environment configures a random `ADMIN_ACCESS_KEY` and a separate random `JWT_SECRET` (both at least 32 characters). No administrator email or profile is requested or stored. A successful access-key check creates a four-hour role-only signed cookie and a CSRF token cookie. Login attempts are rate limited; mutations require the same-site request origin and CSRF token. Audit records use the generic `configured-admin` actor label.

| Method | Route | Purpose |
|---|---|---|
| `POST` / `GET` / `DELETE` | `/admin/session` | Start, inspect, or end the short-lived maintenance session |
| `GET` | `/admin/status` | Inspect imported season freshness |
| `GET` | `/admin/validation/:year` | Review classification completeness, duplicate places, coverage, and supported scoring ruleset |
| `GET` / `POST` | `/admin/refresh/:year` | Inspect refresh state or queue provider schedule and result import |
| `GET` | `/admin/seasons/:year/races/:round/results` | List event classifications for maintenance |
| `PATCH` | `/admin/results/:id` | Correct a supported classification with source and reason |
| `PUT` | `/admin/seasons/:year/races/:round/results/:session/:driverId` | Enter or correct a result in a confirmed round |
| `POST` | `/admin/seasons/:year/races/:round/qualifying` | Enter sourced qualifying records |
| `POST` | `/admin/seasons/:year/races/:round/recaps` | Add a source-linked fact or interpretation |
| `GET` | `/admin/overrides`, `/admin/audit` | Inspect active overrides and audit history |
| `POST` | `/admin/overrides/:id/revert` | Roll back an unchanged override with conflict checking |

These routes are absent from public navigation. Manual classifications are limited to confirmed rounds and the supported 2026 ruleset; ties that cannot be resolved from verified data are rejected instead of silently assigned an order.

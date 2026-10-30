# Data source findings

Research checked 29 October 2026. Jolpica-F1 is the proposed default provider adapter. It is a volunteer-maintained successor to the Ergast-compatible API and has both the compatibility API and a newer API documented.

## Coverage and endpoints

The Ergast-compatible endpoint set documents seasons, races/schedules, circuits, drivers, constructors, results, qualifying, sprint, driver standings, constructor standings, laps, and pit stops. The new API documentation includes schedule, result, session, driver, team, circuit, lap, and pit-stop resources. The service's historical F1 data lineage covers seasons from 1950; current-season completeness and post-event availability must be tested per endpoint and round. Do not treat a listed endpoint as a guarantee that every season has complete values.

| Requirement | Finding |
|---|---|
| Calendar / circuits / locations | Documented in compatibility `races` and `circuits` resources; newer API has schedule resources |
| Race results / standings | Documented `results`, `driverstandings`, and `constructorstandings` endpoints |
| Qualifying | Documented `qualifying` endpoint |
| Sprint results | Documented `sprint` endpoint |
| Pit stops | Documented `pitstops` endpoint; coverage and completeness need per-season checks |
| Photos, logos, biographies | Not documented as provider resources; assume none are supplied or licensed for our use |
| Live coverage | Not in scope; do not consume any live/session-timing feed |

## Operations, cost, and terms

- Public access requires no API token in the published docs. Jolpica's current stated unauthenticated limits are 4 requests/second burst and 500 requests/hour sustained; it warns these may change. Cache results, use filtered/paginated requests, obey `429`, and use exponential backoff.
- The service is free for non-commercial use. Jolpica states the data is CC BY-NC-SA 4.0 and asks commercial users to contact them. We must attribute Jolpica and preserve the same license for adapted data where applicable. Recheck terms before any commercial use or redistribution.
- It is volunteer-run and makes no uptime or correctness guarantee. No published post-race update SLA was found. Results may be delayed; retry after scheduled event end, preserve the last successful snapshot, and visibly mark data stale until refreshed successfully.
- Official API docs list compatible routes; documentation and rate limits can change. Pin provider expectations in adapter contract tests and record the retrieval time.

## Recommended adapter policy

Use a provider interface with Jolpica as one implementation and a manual import/correction adapter as fallback. Cache successful responses, retain raw response provenance, validate season/round/entrant identities/duplicate positions/points, and perform writes atomically. Provider totals are cross-checks; standings are recalculated from stored classified results and that season's versioned official scoring rules. If the provider omits a value, represent it as unavailable rather than deriving or fabricating it.

The backend reads schedules and race/sprint classifications from Jolpica's Ergast-compatible endpoints. The importer validates season/round identities, duplicate drivers, sprint availability, and 2026 full-distance scoring, then recalculates local standings from imported result rows in a transaction. On 29 October 2026, the 2026 schedule fetch returned 23 rounds; the result endpoint returned confirmed classifications only through round 5, while the schedule indicated events through round 18 had passed. The local status is therefore marked stale through round 5, and the UI shows that gap. The importer is gated when points differ from the implemented rules because the adapter does not receive enough race-distance data to score shortened races safely. This is a manual local refresh command today; automatic updates must not be claimed until scheduled retries and failure recovery are implemented and tested end-to-end.

## Sources

- [Jolpica-F1 endpoint documentation](https://github.com/jolpica/jolpica-f1/blob/main/docs/README.md)
- [Jolpica-F1 API reference](https://api.jolpi.ca/docs/)
- [Jolpica-F1 rate limits](https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md)
- [Jolpica-F1 terms of use](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md)
- [FIA 2026 General Regulatory Provisions, Issue 02](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_02_-_2026-02-27.pdf), Articles A2.1–A2.2 (scoring and tie-breaks)

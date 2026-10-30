# Backend

Independent TypeScript REST API for F1 Championship Companion. The initial public routes, Prisma schema, Jolpica schedule adapter, and local schedule importer are in place.

See `docs/DATA_SOURCES.md` and `../docs/API_CONTRACT.md`. Local storage currently uses SQLite; PostgreSQL requires a future Prisma provider and migration change. Copy `.env.example` to `.env`, run `pnpm install`, `pnpm db:migrate`, then `pnpm dev`. Import the schedule with `pnpm ingest:schedule -- 2026`. After completed results are published, `pnpm ingest:results -- 2026` validates result points against the verified 2026 full-distance rules, checks sprint rounds, and recalculates standings. Scoring mismatches leave the last good data intact and flag the season stale.

## Maintenance access and privacy

Admin maintenance is disabled by default. To enable it, configure a random `ADMIN_ACCESS_KEY` (at least 32 characters) and a separate random `JWT_SECRET` (at least 32 characters) in the backend environment, then restart the service. Do not put either value in the frontend environment or commit it. Admin actions use short-lived signed cookies, CSRF checks, request rate limiting, source attribution, and generic audit actor labels; no admin email or profile is collected. Public routes remain anonymous. Manual result edits are limited to confirmed rounds and the supported 2026 scoring ruleset.

The EC2 backend service uses SQLite outside the source checkout and a systemd timer to retry the schedule/results import every six hours. Provider gaps and failed imports remain visible as stale status. Only the verified 2026 scoring ruleset is supported at present; see `../docs/HOSTING.md` for instance setup and network rules.

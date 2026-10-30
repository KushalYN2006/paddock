# F1 Championship Companion

An independent, unofficial Formula 1 companion for exploring completed Grands Prix, championship standings, season rules, and beginner-friendly explanations. It is not affiliated with Formula 1, the FIA, or any team. No live timing or in-race coverage is planned.

## Project status

Phases 1–7 are implemented: setup and research, the core site and data pipeline, beginner learning, the three-level championship calculator, race recaps and analysis, a transparent predictions v1, and the secured maintenance workspace. Predictions remain hidden until a rolling back-test shows enough history and the model matches or beats a points-only baseline. Recap facts are sourced or derived from classifications; unsourced text is withheld. Analysis shows unavailable states where qualifying or validated pit-stop data is missing. See [the architecture](docs/ARCHITECTURE.md), [API contract](docs/API_CONTRACT.md), and [data source findings](backend/docs/DATA_SOURCES.md).

## Local setup

The frontend and backend are independently installable applications. In separate terminals:

1. In `backend/`, install packages, copy `.env.example` to `.env`, run `pnpm db:migrate`, then `pnpm dev`.
2. In `frontend/`, install packages, copy `.env.example` to `.env`, then run `pnpm dev`.

Local persistence currently uses SQLite. PostgreSQL is a later database-provider change; `DATABASE_URL` is configurable, but the current Prisma schema targets SQLite. From `backend/`, load schedules with `pnpm ingest:schedule -- 2026` and refresh confirmed classifications with `pnpm ingest:results -- 2026`. Results are validated against the season's scoring rules before standings are recalculated. The two-instance AWS EC2 deployment files are in [docs/HOSTING.md](docs/HOSTING.md); no AWS resources are created by the local setup.

## Trust and attribution

The API data source is Jolpica-F1, subject to its attribution and non-commercial ShareAlike terms. This app will show season, last confirmed round, update time, and stale status. Provider data and calculated standings will be validated before being displayed as confirmed.

See [docs/HOSTING.md](docs/HOSTING.md) for the deferred hosting note.

## Privacy

The public site is anonymous. It does not require visitor accounts and will not store visitor profiles, favourites, or saved scenarios. Maintenance access is disabled unless `ADMIN_ACCESS_KEY` is configured. The key is provided through the backend environment, never saved to the database; admin sessions are short-lived signed cookies. Operational changes are audited with a generic configured-admin actor, without an admin email or profile. Existing legacy schema records are preserved and are not used by this maintenance flow.

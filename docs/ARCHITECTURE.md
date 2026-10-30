# Phase 1 architecture proposal

## Decisions for this phase

- Product name: **F1 Championship Companion**, matching the supplied build brief. Use a text wordmark and original visual styling; no F1 marks, team marks, or official fonts.
- Season navigation: current season by default; historical seasons read-only wherever provider data and season rules are available. Seed from historical provider data only after the initial contract is accepted.
- Persistence: SQLite for the first local build. PostgreSQL support is deferred until the Prisma datasource and migrations are converted. Both apps remain independently installable and communicate only over REST.
- Anonymous public app: no visitor login, accounts, profiles, favourites, saved scenarios, or collection of personal details. Scenario sharing is URL-based and client-side only. The database stores public F1 data and operational admin/audit records only.
- Images: local custom placeholders/illustrated avatars first. Add only images with explicit reuse rights and stored attribution.
- Admin authentication: the public site remains anonymous. Maintenance access is disabled unless a random environment key and JWT signing secret are configured; short-lived signed cookies and CSRF checks protect mutations. Audit entries use a generic actor label without collecting email or profile details. Legacy admin schema records are preserved and unused by the new access flow.
- Hosting: the repository includes an operator-run two-instance EC2 deployment for Amazon Linux 2023, with Nginx proxying the static frontend to a private backend port and a scheduled importer. AWS resource creation and account-specific networking remain operator steps; no cloud account credentials are stored here.

## Proposed repository tree

```text
f1-championship-companion/
├── README.md
├── docker-compose.yml                 # local development only, optional
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API_CONTRACT.md
│   └── HOSTING.md
├── frontend/
│   ├── package.json
│   ├── .env.example
│   ├── README.md
│   ├── eslint.config.js
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   ├── styles/{tokens.css,glass.css,globals.css}
│   │   ├── components/{glass,layout,race,standings,charts,calculator,learn,status}/
│   │   ├── pages/
│   │   ├── api/
│   │   └── lib/
│   └── tests/
└── backend/
    ├── package.json
    ├── .env.example
    ├── README.md
    ├── eslint.config.js
    ├── prisma/schema.prisma
    ├── prisma/seed.ts
    ├── docs/DATA_SOURCES.md
    └── src/{server.ts,app.ts,config,routes,controllers,services,providers,jobs,scoring,middleware,utils}/
```

The workspace is an initialized Git repository. Phase 1 laid down the decisions and contracts; Phase 2 is now adding the core client, REST API, and provider-backed schedule import.

## Data flow

```text
Jolpica-F1 / manual corrections
              │ provider adapter
              ▼
 fetch → validate → transaction → raw event records
                                  │
                                  ▼
                         versioned scoring rules
                                  │
                    standings snapshots + status
                                  │
                      versioned JSON REST API
                                  │
                       independent frontend
```

Only completed event data is ingested. Scheduled polling can retry after the event's scheduled end until a final result is available. No provider feed is consumed in a way that creates live or in-race coverage.

## Initial scoring ruleset note: 2026

Use the FIA 2026 General Regulatory Provisions, Section A, Issue 02 (27 February 2026), Article A2.2, as the source of truth. Full distance race points are 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for positions 1–10. The regulation also defines reduced points for races under 75% distance, a two consecutive lap condition without SC/VSC, and sprint points 8–1 for the first eight positions when at least 50% sprint distance is completed (and the two-lap condition is met). Ties share the points for tied positions. The regulations do not list a fastest-lap bonus. Championship tie-break is race wins, then second places, and so on; if still tied, qualifying results apply. Encode exact rules with source/version and effective date; do not infer sprint/race scoring across seasons.

Official source: [FIA 2026 General Regulatory Provisions, Issue 02](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_02_-_2026-02-27.pdf).

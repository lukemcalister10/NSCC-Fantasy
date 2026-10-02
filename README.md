# NSCC Fantasy

Club fantasy cricket for the 2026/27 season. React/Vite on Vercel, with Supabase
authentication, Postgres and private player-photo storage.

Production: https://nsccfantasy.vercel.app/ . All league data requires sign-in;
manager access is checked in the app and enforced by the database.

## Current features

- Squad selection, captain/vice-captain, list and field views.
- Up to three player swaps submitted together, with pre-lock undo of the latest batch.
- Round lockout and a hold on trading while the previous round's results are pending.
- Fixtures, matchup squad comparisons, team profiles, sortable ladder and team values.
- Player headshots, averages, last-round scores, ownership and ownership history.
- Player profile overlays, 2025/26 club stats and prices shown after each frozen round.
- Club availability feed with manager overrides; actual scorecard participation determines scoring.
- Manager registry, availability/photo editing, scorecards, rounds, recompute and freeze checks.
- Home-screen icons and web app manifest for installation on phones.

Round 1 counts nine players. From Round 2, the live NSCC season counts the best eight
individual scores plus one additional captain score. That additional score counts
even when the captain's ordinary score is dropped. The vice replaces a captain who
did not play; a played zero is still a played score. See the in-app Help page for
the current scoring and pricing settings.

## Operations and maintenance

Start with [MAINTENANCE.md](MAINTENANCE.md) for the weekly publication sequence,
deployment checks, connection checks and known limitations. Do not use old seed or
setup instructions on the active competition.

- `app/`: participant and manager screens, browser queries and mutations.
- `api/`: server-only availability proxy and manager recompute/connection health endpoint.
- `src/engines/` and `src/recompute/`: scoring, pricing and complete-season recomputation.
- `src/db/`: raw data loading and transactional derived-state persistence.
- `supabase/migrations/`: ordered database changes (`0001`–`0019` currently).
- `test/`: engine, database, permissions, trade, lock and regression tests.
- `app/routes/Help.tsx`: editable Help text; some values are read from season configuration.
- `app/data/previousSeason2526.json`: imported prior-season club statistics.

Raw scorecards, trade/selection records and approved season rules determine the results.
Correct raw inputs and recompute; do not hand-edit scores, prices or ladder rows.

## Local development

Install dependencies with `npm ci`. Copy `.env.example` to `.env.local` and supply the
public Vite Supabase settings. The example points at the live project: use a separate
test project for writes or destructive rehearsals.

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm run preview
```

`build` also checks application TypeScript. Tests use disposable PGlite databases;
they do not require writing to production. CI runs type checking, tests and a build
on pull requests and pushes to `main`. The last full local run on 30 September 2026
passed 55 files / 435 tests; this is a dated result, not a permanent test count.

Pages load separately when opened. Manager-page code stays out of the participant
startup download, and off-screen headshots load as they approach the viewport.

Deployments follow the connected Vercel project. Check the actual Production
deployment's commit and Ready status after a push, then verify the affected signed-in
flow. A build or a public login page alone does not verify that flow.

## Historical reference

[Archived pre-launch reports](docs/archive/README-pre-launch.md),
[MANAGER_VERIFY.md](MANAGER_VERIFY.md), [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md) and
[SUPABASE_LIVE_VERIFY.md](SUPABASE_LIVE_VERIFY.md) retain earlier setup evidence.
`KICKOFF.md`, `DEFINITION_OF_DONE.md` and `DECISION_LOG.md` retain the original design
and decisions; later approved changes are represented by the current code and tests.

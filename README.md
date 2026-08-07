# NSCC Fantasy Cricket

> **Latest slice: MANAGER CORE (S-A), 07/08/2026** — player registry (+ CSV seed import),
> round management, multi-innings scorecard entry, the recompute control, D22 name
> normalisation and the D24 scorecard freeze. Apply/verify runbook: **`MANAGER_VERIFY.md`**
> (migrations `0005`–`0007`, the `/api/recompute` configuration, and the smoke test).
> State-stamp: builds against KICKOFF v1.3 / DoD v1.2 (frozen) / DECISION_LOG **v1.9**,
> continues from `main @ e698c77`. `src/engines/*` and `src/recompute/*` untouched
> (`git diff -- src/engines src/recompute` prints nothing).
>
> The section below is the preceding slice's report (read-only league views), kept as the
> record of how the frontend got here.

## Read-only league views (frontend slice 1)

Club fantasy cricket platform. Prior slices landed the **engine core** (scoring, pricing, cap
ledger, starting price), the **Supabase schema + persistence + recompute**, the **full derived
chain** (team-round scoring, H2H, ladder, overall leaderboard), **DB-level lock enforcement**
(G4/G6/G10 + riders), the **A7 squad reshape + cap-at-lock**, **selection validation** (G15), and
the **auth boundary** (G13 — RLS across the whole schema). This slice adds the **first frontend**:
a deployable **React/Vite** app (D16) delivering the **read-only league views** — login, ladder +
overall leaderboard, player price list, player profile, and rounds/fixtures — every view behind
Supabase auth (D17/Law 11), authorization done entirely by the **anon-key client + RLS**. **No
writes, no service-role usage in the app.** The database stays the gatekeeper.

State-stamp: as-of 2026-07-09 · builds against KICKOFF **v1.2** / DEFINITION_OF_DONE **v1.2** /
DECISION_LOG v1.7 · continues from `main @ 3ef8a85` (logo under `Assets/`; G13 live-confirmed) ·
`src/engines/*`, `src/recompute/*`, `supabase/migrations/*` **untouched** (diff-proven below).

## Plain read + operator decisions (read first)

- **Scope (kickoff):** read-only league views ending in a deployable React/Vite app; auth via
  Supabase (magic link **and** email+password, which the seeded test users have); anon client +
  RLS does all authorization; **no write paths, no service-role in the app**. Design brief binding.
- **Player photos (asked & answered):** the schema has no `players.photo_path` / storage bucket,
  and this slice must leave `supabase/migrations` untouched — so photos render as **monogram
  avatars on NSCC blue**, and real `players.photo_path` + storage bucket + storage RLS + upload
  are deferred to the **manager-backend slice** (uploader and column belong together). The photo
  slot is a fixed square so a real `<img>` drops in later with **zero layout change**.
- **Verification path (operator refusal, honoured):** no secrets provided — no `SUPABASE_DB_URL`,
  no service-role, no test-user passwords. So the seed is an **SQL-editor paste** (not a local
  script), and **live-authed render is verified by the operator via `VERCEL_DEPLOY.md`** (the
  smoke test). In-repo I verified: `npm run build` clean, the **logged-out boundary** (Playwright:
  every protected route redirects to `/login`), the **seed through the full trigger stack** (pglite),
  and the **authed views render** against seed-shaped data (Playwright, no page errors).
- **Seed riders (A + B):** the seed is a **pair** — `seed_raw.sql` (raw truth) + `seed_derived.sql`
  (the derived rows **computed by `recomputeSeason` in-process** and serialized — prime invariant
  D15/G3, never hand-written). The raw seed passes the **live trigger stack legitimately**: future
  `lock_at`, legal within-cap squads, a captain per team-round; **no bypass** (verified in pglite).
- **Display note (D21):** pre-season-lock, fixtures render with a **"provisional"** label — the
  team set can change until lock, so the derived schedule is not yet final.
- **This slice moves no DoD gates** (B1 later; not G12).

## Build report (Standing Rule §1)

### What changed
- **The React/Vite app under `app/`** (new): `main.tsx` (React Query + Router providers),
  `App.tsx` (routes + `<RequireAuth>` guard), `auth/` (`AuthProvider` session context +
  `RequireAuth` D17 guard), `lib/` (`supabase.ts` anon client, `queries.ts` typed read hooks,
  `format.ts`), `components/` (`AppShell`, `BroadcastPanel`, `RoleBadge`, `PriceMovement`,
  `PlayerAvatar` photo-ready slot, states), `routes/` (`Login`, `Ladder`, `Players`,
  `PlayerProfile`, `Rounds`), `styles/` (`tokens.css` design tokens + `components.css`),
  `assets/nscc-logo.avif`.
- **Toolchain (new/edited):** `index.html`, `vite.config.ts`, `tsconfig.app.json`, `public/favicon.svg`;
  `package.json` gains React/Vite/Supabase/React-Query deps + `dev`/`build`/`preview`/`seed:generate`
  scripts (existing `test`/`typecheck` untouched); `.env.example` gains `VITE_` vars (public defaults).
- **Seed (new):** `scripts/generate-seed.ts` builds one demo `RawSeason`, runs the real
  `recomputeSeason`, and emits **`supabase/seed/seed_raw.sql` + `supabase/seed/seed_derived.sql`** —
  idempotent, trigger-legal, engine-derived.
- **`VERCEL_DEPLOY.md`** (new): operator runbook to the post-G13 standard — dashboard-first from a
  fresh Vercel account, seed step, env-var setup, Supabase redirect-URL wiring, a numbered smoke
  test ending at a preview URL.

### What did NOT change
- **`src/engines/*`, `src/recompute/*`, `supabase/migrations/*` — byte-for-byte untouched.** Proof:
  `git diff -- src/engines src/recompute supabase/migrations` prints **nothing**. The app only
  imports the pure `generateRound` (D21) from `src/recompute/roundRobin.ts`; the seed generator
  imports `recomputeSeason`/`FIXTURE_CONFIG` — imports, not edits.
- No writes, no service-role in the app; no G12 transcription; no admin; no selections/holdings
  cross-check. Player photos not modelled (deferred, see decisions).

### Design tokens (from the binding brief)
Clean-modern base (`--surface` white, `--border` hairline, generous `--sp-*`); **NSCC blue
`#193889` the sole accent**; the **broadcast treatment** (navy `#0d1b45` / chrome `#193889`)
**reserved for the ladder header + score readouts only**; green `#1a7f4b` up / red `#c23a3a` down
movement; role-badge tints; mobile-first (phone base, `min-width` scale-ups). SuperCoach density on
the player list (avatar · role badge · price · ▲/▼ movement · per-row stats).

### Gates moved
- **None.** This slice moves no DoD gate (as scoped). G4/G6/G10/G13/G15 stay VERIFIED, untouched
  (the app is read-only; RLS/triggers run server-side). **93 engine tests stay green; typecheck
  clean; `npm run build` clean.**
- **Slice definition of done:** `npm run build` clean ✅; logged-out sees only login ✅ (Playwright);
  seed passes the live trigger stack ✅ (pglite) and the authed views render ✅ (Playwright, seed-
  shaped data). **All pages render live Supabase data as an authed test user** → **operator-verified
  via `VERCEL_DEPLOY.md`** (secrets withheld by design; runbook ends at the preview URL).

### Open hypotheses
- **Live-authed render is operator-confirmed, not builder-confirmed** — no test-user credentials or
  DB secrets were provided (by choice). The in-repo checks (build, boundary, DB-seed, mocked-data
  render) de-risk it; the `VERCEL_DEPLOY.md` smoke test closes it.
- **Season auto-pick** — the app renders the most-recent `seasons` row. Fine while the live DB holds
  one season; a season switcher is a later concern.
- **Player photos deferred** — rides with the manager-backend slice (column + bucket + upload).

### Next action / next slices
1. **Operator: run `VERCEL_DEPLOY.md`** (seed the pair, deploy, smoke test) → records the preview URL
   and flips the slice's live-render item to confirmed.
2. **Manager backend**: scorecard entry/review, player registry + **photo upload** (`players.photo_path`
   + storage bucket + RLS), settings, recompute trigger.
3. **G12 transcription guardrail**; **B1 baseline**.

### Burn report
One session: scaffolded a React/Vite/TypeScript app at the repo root (React Query + React Router +
Supabase anon client, CSS-token design system); built login (magic link + password), ladder +
leaderboard (broadcast header), SuperCoach player list, player profile (sparkline + scores), and
rounds/fixtures (derived via `generateRound`, provisional label); wrote a recompute-derived,
trigger-legal, idempotent SQL seed pair + generator; wrote `VERCEL_DEPLOY.md`. Verified build clean,
93 engine tests green, the logged-out boundary and authed render via Playwright, and the seed through
the full pglite trigger stack. Engines/recompute/migrations untouched (diff-proven).

## Run it

```bash
npm install
npm run dev        # Vite dev server (reads VITE_SUPABASE_* from .env)
npm run build      # tsc -p tsconfig.app.json --noEmit && vite build → dist/  (must be clean)
npm run seed:generate   # regenerate supabase/seed/seed_raw.sql + seed_derived.sql

npm test           # vitest run — the engine gate suite (93 tests)
npm run typecheck  # tsc --noEmit (engine)
git diff -- src/engines src/recompute supabase/migrations   # empty — zero-change proof
```

Deploy: follow **`VERCEL_DEPLOY.md`** (seed → import repo → env vars → Supabase redirect URLs →
deploy → smoke test → preview URL). Live auth boundary confirmation: **`SUPABASE_LIVE_VERIFY.md`**.

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED requires the named gate
and its verifying artifact. APPROVED is the operator's.

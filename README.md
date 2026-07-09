# NSCC Fantasy Cricket — auth-boundary slice (Gate G13)

Club fantasy cricket platform. Prior slices landed: the **computational engine core**
(scoring, pricing, cap ledger, starting price), the **Supabase schema + persistence +
recompute** layer, the **full derived chain** (team-round scoring, H2H, ladder, overall
leaderboard), **DB-level lock enforcement** (round lock G4, mid-match trade lock G6, season
lock G10 + riders), the **A7 squad reshape + cap-at-lock**, and **selection validation**
(G15). This slice implements **Gate G13** — the **auth boundary**: row-level security
across the whole schema, so the database enforces WHO may read/write, not just WHEN.

Until now every trigger enforced *when* a write is allowed for **any** database role
(0002 header, "they enforce WHEN a write is allowed, not WHO"). G13 adds WHO:

1. **RLS on every table, default-deny.** All 20 tables `ENABLE ROW LEVEL SECURITY`; a
   logged-out (`anon`) client reads **nothing** (D17/Law 11 — privileges revoked, so a read
   is a hard permission error, not a silent empty set).
2. **The manager / participant / service split.** The league manager
   (`profiles.is_league_manager`) has full write on raw-truth / scorecard-family tables;
   an authenticated participant reads league data and writes **only their own** team's
   selections and trades (`owner_profile_id = auth.uid()`); **derived** tables take **no**
   client writes at all (recompute writes them via the service role); `profiles` is
   self-readable/updatable for display fields only, and `is_league_manager` is settable by
   **no** client path (Decision 4).
3. **Lock-gated cross-visibility** (Decision 3): a team's own selections/trades are always
   visible to its owner; others' become visible to all authed users only after **that
   round's `lock_at`** passes, then forever; the manager sees everything always.
4. **The `app.locks_bypass` GUC is authorised** (requirement 3): the G4 round-lock hatch is
   honoured **only** when the acting user is a league manager (superuser/service backend, or
   an authed manager). Bypass set by a non-manager is ignored → the locked-round write is
   rejected.

The database stays the gatekeeper (D16): the whole boundary is Postgres RLS + a handful of
`SECURITY`-scoped helpers, tested in pglite by **simulating the Supabase auth context**
(`SET ROLE` + `request.jwt.claims`) so G13's cases run in the gate suite like everything
else. Honest label (Law 1): **G13 = VERIFIED (pglite-simulated auth); live confirmation
pending** via `SUPABASE_LIVE_VERIFY.md`.

State-stamp: as-of 2026-07-09 · builds against KICKOFF **v1.2** / DEFINITION_OF_DONE
**v1.2** / DECISION_LOG v1.7 · continues from `main @ b938cdc` · `src/engines/*` and
`src/recompute/*` untouched (diff-proven below).

## Plain read + operator decisions (read first)

- **Four binding decisions (pre-set this session), honoured verbatim:** (1) profiles read =
  the enumerated set `{id, display_name, photo_path, is_league_manager}` of every profile,
  future columns private by default; (2) participants self-register their own team
  (INSERT/UPDATE where `owner = auth.uid()`, name-only, one team per profile per season as a
  unique index); (3) selections/trades cross-read is lock-gated; (4) `is_league_manager` has
  **no** client write path for any role.
- **Two sub-details, operator-answered — both "Option 1", recorded:** profiles readable set
  **includes `id`** (the row key, already exposed via `fantasy_teams.owner_profile_id`;
  "private by default" governs data-bearing columns); the two per-team derived tables
  (`team_cap_snapshots`, `team_round_scores`) are **all-authed read** like the standings
  (cap state is derivable from lock-gated trades once rounds lock; rows only exist
  post-recompute, so no pre-lock leak).
- **Approved rider:** 0004 carries the `UNIQUE(season_id, owner_profile_id)` enforcement
  **as an index**, with a G13 case that a second self-registration is rejected on the
  constraint. 0001 already declares it as a table UNIQUE constraint (index-backed); 0004
  adds an **idempotent guard** that guarantees the index and is a **no-op** on the standard
  schema (never a duplicate).
- **Two acknowledgements:** draft-scorecard authed-readability is accepted this slice
  (refined with G12); participant team-DELETE is manager-only by design.
- **Adversarial validation applied before coding.** A plan-review pass caught a headline
  bug in the draft: a fully-`SECURITY DEFINER` `is_manager()` returns true for **everyone**
  (inside a definer function `current_user` = the owner = superuser). Fixed by **splitting**:
  `app.is_manager()` is **INVOKER** (the role check runs as the acting role), delegating only
  the `profiles`-flag read to a tiny **DEFINER** helper. Also folded in: null-safe
  `auth.uid()`, explicit SELECT policies on every readable table, per-command
  selections/trades/fantasy_teams policies, explicit `service_role` grants, and `seasons`
  DELETE withheld even from managers (cascade risk).

## Build report (Standing Rule §1)

### What changed
- **`supabase/migrations/0004_rls.sql`** (new) — the whole auth boundary as pure-Supabase
  DDL:
  - `app` schema helpers: `_profile_is_manager()` (DEFINER — reads the flag bypassing
    profiles RLS/column-grants/recursion), `is_manager()` (**INVOKER** — `rolsuper` ∨
    `current_user='service_role'` ∨ the flag), `owns_team(uuid)`, `round_locked(uuid)`.
  - `ENABLE ROW LEVEL SECURITY` + per-command policies on all 20 tables (matrix below).
  - `profiles` column-level GRANTs (read `{id, display_name, photo_path, is_league_manager}`;
    update `{display_name, photo_path}` only — `is_league_manager` in no authed grant).
  - `CREATE OR REPLACE enforce_round_lock()` — the bypass line now requires `app.is_manager()`
    (0002 left untouched; the existing triggers rebind by name).
  - `fantasy_teams` name-only participant-UPDATE trigger + the idempotent unique-index guard.
  - `REVOKE ALL … FROM anon` and `GRANT ALL … TO service_role` on all public tables.
- **`test/helpers/pgliteDb.ts`** — a test-only **Supabase shim** (the 3 roles, `service_role
  BYPASSRLS`, `auth` schema + null-safe `auth.uid()`/`auth.role()`) applied **before** the
  migrations, plus `asAuthed(db, {role, sub}, fn)` which runs a probe under `SET LOCAL ROLE`
  + `request.jwt.claims` in one transaction (so deferred G15/captain checks fire under the
  acting role at COMMIT).
- **`test/g13.auth-boundary.test.ts`** (new) — 11-case pglite gate, hand-worked
  accept/reject with specific-message assertions.
- **`SUPABASE_LIVE_VERIFY.md`** (new) — operator runbook: apply 0001→0004; the Supabase-only
  `auth.users` FK + `handle_new_user` wiring (fulfils the 0001 forward-reference, kept out of
  the migrations so pglite stays green); the `is_league_manager` promotion entry; a numbered
  live checklist mirroring the gate, with the "SQL editor bypasses RLS → drop role" gotcha
  called out.
- **`.env.example`** (new) + `.gitignore` — URL/anon placeholders; service-role key named
  but never requested; real `.env*` ignored.

### What did NOT change
- **`src/engines/*` and `src/recompute/*` — byte-for-byte untouched.** Proof:
  `git diff -- src/engines src/recompute` prints **nothing**. The boundary is entirely RLS +
  SQL helpers; recompute keeps writing derived state as the trusted backend (service role /
  superuser), which bypasses RLS by design.
- **0002 / 0003 migrations untouched.** `enforce_round_lock` is superseded by a
  `CREATE OR REPLACE` in 0004 (append-only discipline); the existing triggers pick up the new
  body automatically.
- No React UI; no G12 transcription; no selections-vs-holdings cross-check.

### Policy matrix (table × role × operation)
`A`=any authenticated · `M`=manager · `O`=owner · `L`=round locked · `S`=service/superuser
only · `∅`=no client path. **anon = nothing (revoked) on every table.**

| Table(s) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `seasons` | A | M | M | ∅ (cascade risk) |
| `profiles` | A, cols `{id,display_name,photo_path,is_league_manager}` | ∅ (signup) | self, cols `{display_name,photo_path}` | ∅ |
| raw-truth ×8 (`players`,`rounds`,`matches`,`scorecards`,`scorecard_lineup`,`batting_lines`,`bowling_lines`,`dismissals`) | A | M | M | M |
| `fantasy_teams` | A | M∨O | M∨O + name-only trigger | M |
| `selections`,`trades` | M∨O∨L | M∨O | M∨O | M∨O |
| derived ×7 (`player_match_scores`,`price_history`,`team_cap_snapshots`,`team_round_scores`,`h2h_results`,`ladder`,`overall_leaderboard`) | A | S | S | S |

### Gates moved (PROPOSED → DERIVED → BUILT → VERIFIED)
- **G13 AUTH_BOUNDARY** → **VERIFIED (pglite-simulated auth)** by
  `test/g13.auth-boundary.test.ts` — manager writes pass; cross-team writes rejected;
  non-manager raw-truth writes rejected; derived client writes rejected (service_role
  passes); anon reads denied; bypass-without-manager rejected; lock-gated cross-read; profiles
  self-service; one-team-per-season. **Live confirmation pending** (`SUPABASE_LIVE_VERIFY.md`).
- **G4 / G6 / G10 / G15 / Rider 1 stay VERIFIED, untouched** — they run as the superuser,
  which bypasses RLS; the manager-gated bypass keeps G4's repair-hatch cases green
  (superuser → `is_manager()` true). **93 tests green** (was 82; +11 G13 cases).

### Open hypotheses
- **Draft vs committed scorecard visibility** — all raw truth is authed-readable this slice
  (accepted); refining who sees `scorecards.review_state = 'draft'` rides with **G12**.
- **Profile provisioning is out-of-band** — the client has no `profiles` INSERT; a signup
  `handle_new_user` trigger (runbook, Supabase-only) creates the row. A `fantasy_teams`
  INSERT depends on that row existing (FK), as it will post-signup.
- **Enforcement triggers under RLS** — the G15/captain/mid-match triggers aggregate a team's
  own rows, always visible to the owner; the boundary holds only because raw-truth is
  authed-readable and own-rows are owner-visible. Proven by case 2 committing a full squad as
  a participant.

### Next action / next slices
1. **Operator: run `SUPABASE_LIVE_VERIFY.md`** against the live project to flip G13 to
   live-confirmed (and record the promotion runbook entry in use).
2. **G12 transcription guardrail** — LLM scorecard → review → commit; folds in draft-visibility.
3. **React/Vite app** + baseline **B1**; **selections-vs-holdings** cross-check.

### Burn report
One session: added `0004_rls.sql` (RLS on all 20 tables, `app` helper predicates with the
INVOKER/DEFINER split, column-scoped profiles, manager-gated bypass, the idempotent unique
index, anon lockout + service-role grants); a test-only Supabase shim + `asAuthed` harness;
the 11-case G13 gate; the live-verify runbook + `.env.example`. Adversarial pre-review caught
the DEFINER `is_manager` auth hole before coding. Engines/recompute untouched (diff-proven).
82 → 93 tests green; typecheck clean.

## Run it

```bash
npm install
npm test          # vitest run — the gate suite (93 tests, incl. pglite-backed G3/G4/G6/G10/G13/G15)
npm run typecheck # tsc --noEmit
git diff -- src/engines src/recompute   # empty — zero-change proof
```

Live auth confirmation: follow `SUPABASE_LIVE_VERIFY.md` against the real Supabase project.

## Status vocabulary (Standing Rule §3)
PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED. "Done" is banned. VERIFIED requires the
named gate and its verifying artifact. APPROVED is the operator's.

# MANAGER_VERIFY — manager core (S-A), apply + verify runbook

State-stamp: as-of 07/08/2026 · slice **S-A manager core** · builds against KICKOFF v1.3 /
DEFINITION_OF_DONE v1.2 (frozen) / DECISION_LOG **v1.9** · continues from `main @ e698c77`.

This runbook takes the operator from a live project running migrations `0001–0004` to a working
manager backend: **player registry** (with the CSV seed import), **rounds**, **scorecard entry**,
and the **recompute** control. Photos are NOT in this slice (deferred, with migration 0007's
number left free for them — see "What is not here").

Everything below is verified in-repo against pglite except the two steps that need real
credentials (the hosted recompute route and a live browser session); those are yours, and they
are marked **OPERATOR**.

---

## Step 1 — apply the three new migrations, in order

In the Supabase SQL editor, run each file whole, in this order. Each is idempotent only in the
sense that it fails loudly if run twice — run each once.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/migrations/0005_registry_names.sql` | D22 name normalisation as a database trigger + `app.normalise_name()`; one-registry-entry-per-name index; `player_registry_events` audit table written by trigger; mid-season price default (C4) |
| 2 | `supabase/migrations/0006_scorecard_innings.sql` | innings on batting/bowling/dismissals (D5); `not_out` + `maidens` for O4; `raw_text` renamed to `resolved_text`, new `source_text` |
| 3 | `supabase/migrations/0007_scorecard_freeze.sql` | D24 scorecard freeze: `rounds.scorecards_frozen_at`, the one-way mark, the enforcement triggers, and `scorecard_override_log` |

**Expect:** each returns success with no error.

**0005 can legitimately fail**, and if it does the failure is a real finding, not a glitch:

- *duplicate key value violates unique constraint `players_one_entry_per_name_per_season`* — two
  registry rows in one season normalise to the same name. Name-based matching cannot work while
  that is true (an inbound "J. Smith" would be ambiguous forever). Disambiguate one of them in
  the registry first, then re-run.

**0006 rewrites two primary keys.** Existing rows become innings 1, `not_out` false, `maidens`
0 — no data is lost and no existing behaviour changes.

### Re-seed the demo season (only if you use it)

`supabase/seed/seed_raw.sql` / `seed_derived.sql` have been regenerated. If your live project
carries the demo season, re-paste both — the previous pair recorded **fielding 0 for every
player** (see D25), and the new pair scores it correctly. Regenerate anytime with
`npm run seed:generate`.

## Step 2 — configure the recompute route (**OPERATOR**)

The app is a static SPA holding the anon key, and migration 0004 grants `authenticated`
SELECT-only on every derived table — so a browser cannot write derived state, by design.
Recompute therefore runs server-side, in `api/recompute.ts`, which Vercel picks up automatically.

In **Vercel → Project → Settings → Environment Variables**, add (Production + Preview):

| Name | Value |
|---|---|
| `SUPABASE_URL` | your project URL (the same one the frontend uses) |
| `SUPABASE_ANON_KEY` | your publishable key (the same one the frontend uses) |
| `POSTGRES_URL` | the project's Postgres connection string, with `?sslmode=require` |

`POSTGRES_URL` is the only secret of the three. Note what is deliberately absent: no `VITE_`
prefix, so Vite cannot inline it into a browser bundle even by mistake, and no value for it
anywhere in this repository. `test/sa.server-secrets.test.ts` fails the build if any file under
`app/` ever imports the pg driver, the pg adapter, the recompute runner, or names these
variables.

Redeploy after setting them (Vite bakes env at build time; the function reads at runtime, but a
redeploy is the simplest way to be sure both are current).

**If you would rather not put a connection string in Vercel**, skip this step. The button will
report "recompute is not configured on this deployment" and the CLI below still works — it is
the same runner, so the two cannot drift.

### The CLI (works with no deployment at all)

```bash
POSTGRES_URL='…' npm run recompute -- --latest --dry-run   # recompute, report, roll back
POSTGRES_URL='…' npm run recompute -- --latest             # write
POSTGRES_URL='…' npm run recompute -- --season <uuid>
```

`--dry-run` runs the whole pass inside a transaction and rolls it back, so you can see exactly
what would change on a live season before changing it.

## Step 3 — the smoke test (**OPERATOR**; this IS the slice's live verification)

Sign in as a league-manager account (`profiles.is_league_manager = true`) and work through these
in order. The **Expect** line is the pass condition.

**1. Non-managers see nothing.** In a private window, sign in as an ordinary participant and
visit `/admin`. **Expect:** "Manager access only". Signed out entirely, `/admin` bounces to
`/login` (D17). Neither is the real boundary — RLS is — but both must hold.

**2. Registry renders.** Open **/admin/players**. **Expect:** every registered player with role,
WK flag, starting price and active state; the season-lock banner states plainly whether prices
and roles are editable.

**3. Add a player.** Add one with a curly apostrophe in the name (paste `O’Brien`).
**Expect:** the form shows you the normalised form before saving, and the saved row reads
`O'Brien` with a straight apostrophe (D22).

**4. CSV import — review before commit.** Choose your registry CSV in the import panel.
**Expect:** a table of every row with its **recomputed** price beside the file's
`starting_price_reference`; any disagreement flagged in amber; malformed rows blocked with the
line number; nothing written until you press **Import**. Press Import.
**Expect:** the registry now holds the imported players at the *engine's* prices.

> The price column in the file is a cross-check, never input. If a row disagrees, the engine's
> value wins and the row is flagged so you can decide whether the *file* is wrong.

**5. Rounds.** Open **/admin/rounds**, create a round. **Expect:** the lock defaults to 11:00
Adelaide next Saturday, is editable, and displays in Adelaide time with the label. Add a match
with its **final day** date (D5).

**6. Scorecard entry.** Open **/admin/scorecards**, pick the match. Tick the named XI, choose the
keeper, enter batting and bowling for innings 1, then **Add an innings** and enter innings 2.
Add dismissals by typing them as they read ("c Sam Hollis b …"). **Expect:** each line reports who
it credits as you type; a misspelt fielder reads "not in this lineup" and the **Save** button is
disabled until it is fixed (D25). Save, then **Mark match finalised**.

**7. Recompute.** Open **/admin**, press **Recompute season**. **Expect:** a summary naming which
derived families changed, how many price movements differ, and which rounds moved. Press it again
without changing anything. **Expect:** "Recomputed — nothing changed" (that is G3 idempotence,
visible).

**8. The scores are right.** Open the player pages for the players you entered.
**Expect:** batting totals are the SUM of both innings, and the fielders you named carry catch /
stumping / run-out points. (Before this slice they carried none — D25.)

**9. Post-lock refusal.** If the season is locked: **Expect:** roles, WK eligibility and prices
are not editable on /admin/players, and the banner says why. To check the boundary itself rather
than the chrome, run the direct write in the SQL editor as an authenticated manager —
`UPDATE players SET starting_price = 1 WHERE id = '…'` — and **expect** the trigger to refuse it
(D4/D9/G10).

**10. End lockout (D24) — do this LAST and on a scratch round.** On a round whose scorecards are
complete and checked, press **End scorecard lockout**, confirm.
**Expect:** the round shows "Scorecards frozen"; every scorecard field for that round becomes
read-only; and a direct SQL edit to any of its lines is refused by the database. This is one-way:
the mark cannot be cleared or moved.

### The override, if you ever genuinely need it

A frozen scorecard can be amended only by a deliberate, logged act. In the SQL editor, in **one**
transaction:

```sql
BEGIN;
SELECT set_config('app.scorecard_override_reason',
                  'B Grade innings recorded against the wrong match; club confirmed 12/11', true);
UPDATE batting_lines SET runs = 42 WHERE scorecard_id = '…' AND player_id = '…';
COMMIT;
```

The reason is not optional and not decorative: the trigger refuses the write without it, and
writes it — with your user id and the timestamp — into `scorecard_override_log`. Review the log
with `SELECT * FROM scorecard_override_log ORDER BY at DESC;`. Then recompute.

## Step 4 — sign-off

Record in the session report: *manager core verified on `<date>`, deployment `<url>`, as manager
`<email>`; migrations 0005–0007 applied; CSV import landed `<n>` players; round `<name>` entered,
recomputed and frozen.* Any mismatch is a defect: capture the screen, the step and the browser
console, and hand it back to the build seat.

---

## What is not here

- **Player photos** — deferred to their own slice, with the storage bucket, the consent
  affirmation (D17 requires club/parental consent BEFORE upload) and the upload UI landing
  together. The frontend still renders monogram avatars, unchanged.
- **The O4 second-innings multiplier** — the scorecard now records innings, but the arithmetic
  (per-innings totalling, one multiplication, one half-up rounding per player per match, captain
  doubling after) belongs to `src/engines/*`, which this slice may not touch. See the session
  report's handoff section.
- **LLM transcription (G12)** — slice S-B. It inherits the seam this slice settled: a dismissal's
  canonical form holds player ids resolved at entry, and `source_text` keeps the raw string.
- **Settings / season lock UI** — `/admin/settings` is still the shared-chrome stub.

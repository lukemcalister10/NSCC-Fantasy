# S-E — PRE-SEASON CORRECTNESS (build report, Standing Rule §1)

State-stamp: as-of **10/08/2026** · base **`main @ eca2109`** (re-checked against GitHub per
Standing Rule 8 — `origin/main` confirmed at `eca2109` at session start) · builds against
KICKOFF **v1.3** / DEFINITION_OF_DONE **v1.2 (FROZEN)** / DECISION_LOG **v2.0** · branch
`claude/se-preseason-correctness-oev6zo` · run in parallel with **S-D (season lock)**, which owns
`supabase/migrations/`.

**NO MIGRATIONS WERE ADDED.** `git diff -- supabase/migrations` prints nothing, as do
`git diff -- src/engines` and `git diff -- src/recompute`. `/admin/settings` is untouched.

---

## Plain read + operator decisions (read first)

- **Five defects, three fixed here, two specified for other seats.** C6 (SPA 404), C8 (Postgres
  SSL) and C9 (recompute latency + honest failure) are fixed and verified. D26 (server-side
  selection materialisation) needs a schema object this session may not add, so it is
  **specified in full for S-D** below. C10 (schedule-index) is an engine contract, so it is
  **specified for the engine slice** and deliberately not implemented.
- **Operator decision 1 — D26 goes to S-D as Design A (trigger-driven, eager).** Approved on the
  reasoning that trades are already refused after lock, so the selection set freezes at lock
  automatically and no scheduler is needed — and G15 then refuses an illegal squad *in front of
  the participant at trade time* rather than silently at lock. The full specification is in
  **"Handoff 1"**; S-D should not have to re-derive it.
- **Operator decision 2 — C7: guard the client writer now, remove it when the trigger lands.**
  Deleting the only writer before the trigger exists would give every participant an empty
  selection set, and a zero score, for any round locking in between. The banner is gone because
  its cause is gone; the writer's removal is a named one-file follow-up.
- **Operator decision 3 — `src/db/repository.ts` was placed in this slice's fences** so the
  batching fix could land: "honest-but-slow is not sufficient for a weekly operation carrying a
  30-minute budget (B1)."
- **Operator decision 4 — the C11 demo-seed apply test was approved** (new file only).
- **Operator ruling on C10, recorded verbatim in substance:** this is not a display mismatch.
  Indexing by position among active rounds means an empty round acquiring its first match
  **retroactively rewrites settled fixtures** — the ladder changing with hindsight, which D24
  rules out on the same principle. Contract accepted as the target; implementation is the engine
  slice's.
- **This slice moves NO DoD gate.** DEFINITION_OF_DONE v1.2 stays frozen and unchanged.

---

## What changed

### C6 — SPA routing 404 (FIXED, verified in a real browser)

`vercel.json` (new) rewrites every unmatched path to `/index.html`, excluding `/api/`. Vercel's
routing order is redirects → filesystem → rewrites, so static assets and the recompute function
still answer for themselves; the exclusion is belt-and-braces rather than load-bearing.

Verified two ways, because a routing fix asserted in a unit test is a routing fix nobody has
seen work:

1. `test/se.spa-routing.test.ts` applies the rewrite the way Vercel does, over every route in
   `App.tsx`, and pins that `/api/*` is not swallowed.
2. A **live check**: `dist/` served by a throwaway server implementing exactly the `vercel.json`
   rules, driven by headless Chromium at nine typed URLs. **All nine boot the app and, logged
   out, land on the login page** with no league data in the DOM — D17 holds on a typed URL.
   Run again with the rewrite REMOVED, eight of the nine return the 404 (the ninth, `/`, is
   served from the filesystem by the toy server as it is on Vercel) — so the check reproduces
   C6 and then shows it fixed, rather than only asserting the happy path.

What that check **cannot** cover without live credentials is the non-manager `/admin` refusal,
which needs a real authenticated non-manager session. The route tree is unchanged
(`RequireManager` still nests inside `RequireAuth`), and `MANAGER_VERIFY.md` step 1 now says to
perform that check **by typing the URL**, not clicking.

### C8 — Postgres SSL (FIXED)

`src/db/pgClient.ts` now configures TLS explicitly instead of deferring to the URL. The defect
had two compounding causes, both confirmed by reading the installed driver rather than inferred:

- `?sslmode=require` is mapped by `pg-connection-string` to `ssl: {}`, which node-postgres treats
  as **verify-full** (the driver now warns about exactly this). Node's trust store does not carry
  the pooler's CA, so the connection is refused for want of a *certificate*, not encryption —
  surfacing as "self-signed certificate in certificate chain", which reads like a broken database.
- An explicit `ssl` option could not have fixed it, because `ConnectionParameters` does
  `Object.assign({}, config, parse(config.connectionString))`: **the URL overrides the config.**

So `resolveSslPolicy` strips `sslmode` from the URL and returns the policy explicitly: a supplied
CA (`POSTGRES_CA_CERT` / `POSTGRES_CA_CERT_PATH`) verifies the chain; `sslmode=no-verify` or
`POSTGRES_SSL_NO_VERIFY` encrypts without verifying and **says so**; `disable` turns TLS off and
says that too; silence verifies against Node's store. A chain failure is re-thrown naming both
remedies. Eleven cases in `test/se.pg-ssl.test.ts`, the load-bearing one being that `sslmode`
never reaches the driver — forgetting that would silently restore the defect while every other
assertion still passed.

### C9 — recompute latency and timeout handling (FIXED)

Three parts, of which the middle one is the actual cause:

1. **The control degrades honestly** (`AdminHome.tsx`, `adminMutations.ts`). A seconds-elapsed
   counter while it runs; an `AbortController` budget just past the function's own 60s ceiling; a
   **Retry** button; and failures typed as *kinds* (`session`, `refused`, `not-configured`,
   `timeout`, `gateway-timeout`, `network`, `engine`) each carrying the next action, because each
   implies a different one. Where the run may have committed after the page stopped watching, it
   says so rather than guessing.
2. **The latency itself.** `writeDerived` was issuing **one INSERT round-trip per derived row** —
   every player-match score, every price point, every cap snapshot. In-process against pglite
   that is free, which is exactly why the gate suite never felt it; from a serverless function to
   a pooler a region away it is one network round-trip each, and a season is thousands. Now one
   chunked multi-row INSERT per family (`MAX_BIND_PARAMS = 8_000`, an order of magnitude under
   Postgres' 65,535 limit). Same rows, same order, same single transaction.
3. **Connection setup for a serverless caller** (`pgClient.ts`): `keepAlive`, a 15s connect
   timeout so an unreachable host fails by name instead of hanging, `application_name`, and a
   `statement_timeout` above the function budget so a transaction cannot outlive the invocation
   that started it.

`test/se.recompute-batching.test.ts` counts **statements**, not wall-clock — the quantity that
actually maps to latency in the place it hurts — and pairs every count with a row-for-row
comparison. Verified to FAIL when batching is defeated (`MAX_BIND_PARAMS` temporarily set to 8:
the count assertion failed while the correctness assertions still passed, which is the right
shape).

### C7 / D26 — the `/team` duplicate-key banner (FIXED; materialisation ESCALATED)

The cause was more specific than the log records. The carry-forward effect ran as soon as
**holdings** arrived. Hooks run before the component's loading early-return, and `trades` and
`selections` are independent queries — so on a cold load where trades answered first,
`state.selections` was still the empty array it starts as, every open round looked
unmaterialised, and the insert landed on rows that already existed. Postgres refused it (23505 on
`UNIQUE (fantasy_team_id, round_id, player_id)`), correctly, and `/team` showed the participant a
server-refusal banner for something they had not done.

Fixed by distinguishing "no selections" from "not told yet" (`selectionsLoaded` in
`useTeamState`), and by treating a duplicate-key result **in carry-forward only** as benign —
re-read and carry on, because the round already holds exactly what the write was going to put
there. It stays a refusal on every other path, where losing that race is real news.

The writer itself stays until S-D's trigger lands, per operator decision 2, with the trade-off
stated in the code rather than hidden, and the removal reduced to deleting one effect.

### C11 — the audit, and what it found

`writeFileSync` appears in exactly two places in the repo, both seed generators. The finding:

> **`supabase/seed/seed_raw.sql` + `seed_derived.sql` — the DEMO pair, which VERCEL_DEPLOY.md
> step 2 tells the operator to paste — was applied by no test.** Only the dev odd-count pair
> under `supabase/seed/dev/` was covered, by the test S-C added after the original C11 finding.

So the exact failure mode C11 records was still live in the neighbouring file: the demo pair is
correct today only because commit `5e21590` fixed the `raw_text` → `resolved_text` rename **by
hand**. `test/se.demo-seed-applies.test.ts` now applies both emitted files against the real
migration stack, asserts the derived half lands, asserts fielding credit survives the dismissal
path (D25), and asserts idempotence — the property the runbook promises the operator.

Everything else that gets pasted (`MANAGER_VERIFY.md`'s override snippet, `VERCEL_DEPLOY.md`'s
steps) is hand-written prose run by a human, not a machine-generated artifact. Left alone.

### MANAGER_VERIFY.md — corrected

A dated correction note at the top; step 2 now names **which of Supabase's three connection
strings to use** (transaction pooler for the function — the direct host is IPv6-only and a Vercel
function generally cannot reach it) and **how SSL is actually configured**, including why the old
`?sslmode=require` instruction produced a misleading error; a new **step 0** for typed URLs and
refresh; step 1 amended to perform the guard checks by typing; step 7 rewritten to describe
progress, timeout, retry and the fact that an interrupted recompute writes nothing.

---

## What did NOT change

- **`supabase/migrations/` — no migration added or altered** (Standing Rule 9a). Diff-proven.
- **`src/engines/*` and `src/recompute/*` — byte-for-byte untouched** (G11). Diff-proven.
  C10 was diagnosed and specified, not edited.
- **`/admin/settings` and the season-lock action** — S-D's, untouched.
- **What recompute computes.** Batching changed the write, not the output; G3 is the proof.
- **S-C's schedule-disagreement banner on `/rounds`** — deliberately kept as the safety net.
- **The client carry-forward writer** — guarded, not removed (operator decision 2).

---

## Artifacts by name + fingerprint (`git hash-object`, first 12)

| Artifact | Fingerprint | Lines |
|---|---|---|
| `vercel.json` | `c42551eac99e` | 9 |
| `src/db/pgClient.ts` | `4566d63a9779` | 211 |
| `src/db/repository.ts` | `19a80cce11d0` | 530 |
| `app/lib/adminMutations.ts` | `b67d51142fbc` | 470 |
| `app/routes/admin/AdminHome.tsx` | `336a06a35732` | 230 |
| `app/routes/Team.tsx` | `ee12f38a7a6c` | 542 |
| `app/lib/useTeamState.ts` | `e15edfc5d8a2` | 214 |
| `app/lib/teamMutations.ts` | `1913084c7dab` | 471 |
| `MANAGER_VERIFY.md` | `da32fb889333` | 258 |
| `test/se.spa-routing.test.ts` | `03a9c9dd9355` | 87 |
| `test/se.pg-ssl.test.ts` | `12274da9908c` | 101 |
| `test/se.recompute-batching.test.ts` | `99eebecb96bc` | 140 |
| `test/se.demo-seed-applies.test.ts` | `6ee8e695de0e` | 158 |

---

## Gates moved

**NONE**, as the kickoff expected. DEFINITION_OF_DONE v1.2 remains FROZEN and unchanged.

Gates held rather than moved: **G3** (recompute idempotence — the batching change is judged by
it), **G4/G6/G10/G13/G15** (untouched; every enforcement path is database-side and unedited).

**Verification of the slice's own definition of done:**

| Slice DoD item | State |
|---|---|
| Typed URL + refresh resolve on every route | **VERIFIED** — 9/9 typed URLs in headless Chromium; control run without the rewrite reproduces the 404 |
| D17 redirect + non-manager refusal still hold | **VERIFIED (logged-out)**; non-manager refusal is operator-verified — no live non-manager session in-repo |
| Selection materialisation without an app visit | **ESCALATED, not half-built** — specified for S-D in Handoff 1 |
| `/team` duplicate-key banner gone because the cause is gone | **BUILT** — cause identified and removed; needs a live participant load to be VERIFIED |
| Recompute connects on the documented SSL setting | **BUILT + unit-VERIFIED** (11 cases); live connection is operator-verified |
| Recompute control reports progress/timeout/failure honestly | **BUILT** — operator-verified on the next live run |
| MANAGER_VERIFY corrected on connection string + SSL | **BUILT** |
| Schedule-index contract resolved or specified | **SPECIFIED** — Handoff 2 |
| `npm run build` clean · typecheck clean · tests green | **VERIFIED** — build clean, `tsc --noEmit` clean, **250 tests in 31 files** (215 at base, +35 new) |

---

## Handoff 1 — D26 SELECTION MATERIALISATION, specified for S-D

Design A, approved. Everything S-D needs, so nothing has to be re-derived.

**The function.**

```
app.materialise_selections(p_team uuid, p_round uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
```

Rewrites the `(p_team, p_round)` selection set from the **trades ledger** — the ledger is
authoritative (F3), always; selections are never the source. Holdings = every player with more
`buy` rows than `sell` rows for that team, exactly as `holdingsFromLedger` computes it in
`app/lib/squad.ts`.

**Captaincy carry-forward**, in this precedence order, each candidate filtered to CURRENT
holdings — this mirrors `resolveCaptaincy` (`app/lib/teamMutations.ts:257`), which is where the
rule lives today and which becomes redundant once the trigger owns it:

1. this round's existing captain / vice (never overwrite a participant's own choice);
2. the most recent EARLIER round's captain, then its vice;
3. deterministic fallback — the dearest holding, tie-broken by player id — so the mandatory-captain
   invariant (Rider 1) is always satisfiable without asking anyone.

Vice must not equal captain; no vice at all is legal, one captain is not optional.

**Trigger points.**

| When | Trigger | Why |
|---|---|---|
| `AFTER INSERT ON trades` | re-materialise **every open round** (`lock_at > now()`) for that team | the set tracks the ledger continuously, so it is already correct when lock arrives |
| `AFTER INSERT ON rounds` | materialise the new round for every team in the season holding players | a round added later must not be born empty |
| `AFTER UPDATE OF lock_at ON rounds`, when it moves from past to future | same as above | a re-opened round would otherwise stay skipped |

**Why no scheduler, and why this satisfies D26 as written.** D26(b) asks for materialisation at
lock. Trades are already refused after lock (0002), so a set maintained continuously for open
rounds is **frozen at lock by construction** — holdings-at-lock is what stands, which is D26(c)'s
requirement, without a job that has to fire at the right minute. D26(d) falls out too: only open
rounds are materialised, so a team registering after a round's lock has no rows for it and scores
zero, as ruled.

**The consequence that decided it:** G15's composition check then fires at TRADE time, in front
of the participant who can fix it, instead of at lock with nobody watching.

**Interactions to preserve.** The explicit-captaincy path (`setCaptaincy`) writes selections
directly and must keep working — hence rule 1 above. The two-phase captain/vice write exists
because `one_captain_per_team_round` / `one_vice_captain_per_team_round` are IMMEDIATE partial
unique indexes while "exactly one captain" is DEFERRED; a trigger rewriting a set must not
momentarily double a flag either.

**When it lands:** delete the carry-forward `useEffect` in `app/routes/Team.tsx` and the
`syncSelectionsToHoldings` call inside it. Nothing else on that screen depends on it. That is the
D26 removal, in one file — and it should not wait, because two writers of the same rows is how
they diverge.

## Handoff 2 — C10 SCHEDULE-INDEX CONTRACT, specified for the engine slice

**The disagreement.** `src/recompute/h2h.ts:51` indexes fixtures by **position among ACTIVE
rounds**; `app/lib/queries.ts:370` uses **`seq − 1`**. They coincide only while active rounds are
contiguous from seq 1, and D19 makes divergence reachable — a round with no entered matches does
not exist for H2H.

**Why it is worse than a mismatch.** Under the engine's rule, an empty round acquiring its first
match does not merely diverge from the display: it shifts every later round's index by one and
**retroactively rewrites who played whom in rounds already settled**. That is the ladder changing
with hindsight, which the operator has ruled out on exactly this principle (D24).

**Proposed contract, accepted as the target:** *the round index is a property of the round —
`seq − 1` — never its position among active rounds.* A fixture is then knowable before the round
is played, publishable in advance, and immune to what happens in any other round, which is what
D21's determinism is for.

**Implementation, for whoever owns the engine (S-E did not touch it):** pass `{id, seq}` pairs
into `computeH2hResults` instead of a bare id array and use `seq − 1` as the round index.
`src/recompute/orchestrator.ts:165-185` is the only call site. **G9 stays byte-identical** — its
single round is seq 1 → index 0 either way — and the UI needs no change, because it already
derives on `seq − 1`. Natural home: the D28 engine slice, which is already opening these files.

**Do not regress:** S-C's disagreement banner on `/rounds` stays. It withholds a result rather
than attaching it to the wrong pairing, and it should remain as the safety net even once the
contract is fixed.

---

## Open hypotheses

1. **Live confirmation is the operator's**, by design — no deployment credentials in this
   session. The typed-URL fix is browser-verified locally against a faithful reimplementation of
   the rewrite; the SSL policy is unit-verified against the real driver's semantics but has not
   opened a socket to Supabase; the recompute control's failure states are built but have not met
   a real 504. `MANAGER_VERIFY.md` steps 0, 1, 2 and 7 close all three.
2. **Batching should be measured, not assumed, on the live run.** The statement count is proven;
   the wall-clock improvement depends on the function's region relative to the database, which is
   why the runbook now says to set it. Worth recording the seconds figure the control reports.
3. **`maxDuration: 60` assumes a Hobby-tier ceiling.** If the deploy rejects it, the value is the
   thing to change, not the rewrite.
4. **The client carry-forward remains a second writer until S-D's trigger lands.** Guarded, but
   the divergence risk D26 names is real for as long as both exist. It is a race between two
   sessions' merge order, not a permanent state.
5. **C13 (every player falling in the demo recompute) was not investigated** — out of scope, and
   unaffected by anything here.

## Next action

1. **Operator:** merge, redeploy, then run `MANAGER_VERIFY.md` **step 0 first** — typed URLs and
   refresh. It is the cheapest check and it gates everything a participant will do in week one.
2. **Operator:** set `POSTGRES_CA_CERT` (or keep `sslmode=no-verify` knowingly), set the function
   region near the database, and press Recompute — record the seconds figure.
3. **S-D:** implement Handoff 1. When it lands, delete the carry-forward effect in
   `app/routes/Team.tsx` — the D26 removal is one file and should not wait.
4. **Engine slice (D28):** take Handoff 2 with the second-innings multiplier.

## Burn report

One session: read the three governance docs and the whole affected surface; re-checked the base
against GitHub; presented a plan and stopped for approval. Then: added `vercel.json` and proved
the SPA fix in a real browser (nine typed URLs, plus a control run that reproduces the 404);
rewrote the TLS path in `pgClient.ts` after reading the installed driver to find why the URL beat
the config; traced C9's latency to per-row inserts and batched them, with a statement-counting
test verified to fail when batching is defeated; made the recompute control report progress,
timeout, retry and typed failures; found and fixed the exact race behind the `/team` duplicate-key
banner; audited every artifact emitter and closed the one gap it found; corrected MANAGER_VERIFY
on the connection variant, SSL, typed URLs and recompute behaviour; specified D26 for S-D and C10
for the engine slice rather than building either. Build clean, typecheck clean, 250 tests green
(215 at base). No migrations; engines, recompute and `/admin/settings` untouched (diff-proven).

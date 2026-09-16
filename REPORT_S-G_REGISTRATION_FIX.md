# REPORT — BUILD SESSION S-G: REGISTRATION BLOCKER (C16)

### State stamp: built on main @ cb37e99; pushed as 59f3c07 to
### `claude/affectionate-heisenberg-ufpi40`. Governance read: KICKOFF v1.3 ·
### DEFINITION_OF_DONE v1.2 (FROZEN, UNCHANGED) · DECISION_LOG v2.2 + the pasted
### A14 block (11/09 and 15/09/2026), read as authoritative where the two differ.
### Seat: Claude Code (builder). Standing Rule 9: no parallel sessions, built
### against merged main.
### Status per Standing Rule 3: items 1–3 VERIFIED · items 4–5 BUILT, data layers
### VERIFIED, UI halves awaiting the operator acceptance step in §7.

---

## 1. PLAIN READ FOR THE OPERATOR

People can register a team again. Your hypothesis was right in every detail —
including the empty heading — and I verified it against the code before changing
anything rather than taking it on trust.

One correction of emphasis, which is your ruling and which I think is right: the
`?? []` was the **trigger**, not the cause. The cause was that `useTeamState`
derived the team's id and the team's identity **separately**, so the page could
believe a team existed while holding no id for it. That gap is what let a bad
value reach the screen at all, and it would have done so again from any other
producer. §2.2 and §3.1 are written that way round.

The trigger was one `?? []`. The real work, as you said, was the test. There was
never a test that did what a person does: sign in, find no team, register one,
see it. The four demo teams were written by the seed script, so that path had
never been exercised by anybody. I have now written that test, and it drives the
app's **own** registration code against a real database — not a re-implementation
of it in SQL, because a re-implementation would have passed on the broken code,
which is exactly how this survived.

I ran the control run three ways, and the test fails on the broken code with the
defect's own shape: `expected [] to be null`, and
`expected { id: undefined, name: undefined } to be null` — literally the object
your hypothesis predicted `useTeamState` was building.

I also did the audit (item 3) and built items 4 and 5, because neither needed a
migration: every permission they use already exists in 0004. Nothing under
`supabase/migrations/`, `src/` or `app/routes/admin/` was touched.

**One thing needs your eyes before you invite anyone** — the acceptance step in
§7. Rendering is not testable in this harness, so "the form actually appears" is
yours to confirm. It takes about two minutes.

**One judgement call needs your ruling** — §8.1, a two-line `tsconfig` change I
made to keep `npm run typecheck` honest. It is the only thing in this slice that
touched a file outside the named fences, and I would rather you see it than find it.

---

## 2. OPERATOR DECISIONS TAKEN IN THIS SLICE

None were needed on the economy, the schema or the gates. Four builder choices
that were explicitly left to me, each with its reasoning:

**2.1 — The fix's shape (item 1's required statement: which option and why).**
I took a **third option**, neither of the two the kickoff named. I did **not**
change `unwrap`'s contract (the kickoff's option b), and I did not only patch
`useMyTeam` in place (option a). I added a **second helper, `unwrapMaybe`**, for
`.maybeSingle()` reads, and left `unwrap`'s `?? []` byte-identical.

Why: `unwrap`'s `?? []` is *correct* for its ten list callers. Re-pointing all ten
to satisfy one single-row caller would put every one of those call sites in scope
to fix a bug in none of them — the kickoff's own warning. A second helper fixes
the broken caller **and** the class of defect (item 3's adjacent case) while
leaving the list contract untouched. `unwrap` now carries a comment naming C16 and
saying not to pair it with `.maybeSingle()`.

**2.2 — I extracted the has-a-team decision into a plain function, and this is
the part that addresses the actual cause** (the kickoff left the extraction to me,
asking for justification either way). `teamIdentity()` is now the single
derivation, used by `useTeamState` for both the team id and the rendered identity,
and pinned directly by the test.

Why, stated as the cause rather than as a tidy-up — **operator ruling on the
framing, taken after the fix landed, and the framing I now consider correct:**
`useTeamState` derived **two** answers to "have I got a team" from one query,
independently — `teamQ.data?.id` for the id every dependent query keys off, and
`teamQ.data ? {...} : null` for the identity the page renders. Nothing held the
two in agreement, so the page could believe a team existed **while holding no id
for it**, which is exactly the state you saw on 15/09. The brief described the
empty-list symptom; that gap is the structural flaw beneath it, and **any**
malformed value from **any** producer reaches the screen through it. The `?? []`
was merely the producer that did. Collapsing the two derivations into one total
function is therefore what closes the class of defect rather than the incident —
and it is why the control run exercises the two halves of the fix separately
(§3.3 A and B): either alone would have masked the other.

A second reason it earns its place: the *visible* symptom — a squad builder for a
team that does not exist, under an empty `<h1>` — is produced at the **branch**,
not at the query. Since rendering is not testable in this harness, the branch is
the closest thing to the symptom that a test can reach.

**2.3 — Item 5's prompt goes on first sign-in, not in a settings page** (your
call to me). It is mounted inside `RequireAuth`, so every authenticated view is
covered and no router change was needed.

Why: the exposure is live. Until the person answers, everyone reading the ladder
sees their email address. A settings control they never happen to open does not
close that. It is **not** a trap, in three specific ways, because an identity gate
that can strand someone outside the app is worse than the exposure it closes:
a person with **no profile row** is never prompted (an UPDATE would match
nothing, so the form could not succeed); a still-loading read never blocks; and
"Not now" always works, asking again next sign-in rather than nagging within one.

**2.4 — Registration refusals now name the one-team rule.** A second registration
previously fell through `translateRefusal` to the generic "The database refused
this write." It was reported, not swallowed — but it did not say why.

---

## 3. WHAT CHANGED

### 3.1 Item 1 — the defect (MUST). VERIFIED.

**The trigger chain, verified against the code and against the installed library,
not assumed.** The *cause* is the split derivation in §2.2; this is the producer
that exposed it. Your hypothesis, confirmed link by link:

| Link | Verified how |
|---|---|
| `unwrap` returns `res.data ?? []` | read at `app/lib/teamQueries.ts` |
| `.maybeSingle()` gives `data: null` for 0 rows | **read out of `node_modules/@supabase/postgrest-js`** — `PostgrestTransformBuilder` sets `isMaybeSingle`, `PostgrestBuilder` then collapses a 0-row list to `null` (1 row → the object, >1 → PGRST116) |
| so "no team" becomes `[]` | control run: `expected [] to be null` |
| `return row ?? null` returns `[]` | `[]` is not nullish |
| `useTeamState` built `{ id: undefined, name: undefined }` | control run: `expected { id: undefined, name: undefined } to be null` |
| `if (!state.team)` never fired; `teamId` undefined; `InitialBuild` rendered | follows from the above; `teamId` feeds every dependent query |

Every observed symptom follows, including the empty `<h1>`. The cause did **not**
differ from the hypothesis, so nothing needed widening.

**The fix.** `unwrapMaybe` for `.maybeSingle()` reads; `fetchMyTeam` extracted as
a plain function returning `MyTeam | null`; `teamIdentity` as the branch decision;
`useMyTeam` is now a thin hook over `fetchMyTeam`.

Requirement (a) — `useMyTeam` returns `null` when the participant has no team in
that season: **met**, and pinned. Requirement (b) — `unwrap` unchanged, so no
list call site is in scope: **met**, `git diff` shows its body untouched.
Requirement (c) — stated in §2.1.

### 3.2 Item 2 — the test that should have existed (MUST). VERIFIED.

`test/c16.registration-path.test.ts` — 22 tests. It runs the app's **real**
`registerTeam`, `renameTeam`, `fetchMyTeam`, `fetchLeagueConfig`,
`translateRefusal` and `updateDisplayName` against pglite with the real
migrations, RLS and trigger stack, as a real signed-in user.

**How, and why it is built this way.** Every existing team/trade test replays the
app's write *shapes* as hand-written SQL. That is the right tool for "does the
database refuse this" — but it is structurally incapable of seeing C16, whose
entire substance is *what supabase-js hands back and what `app/lib` does with it*.
A SQL re-implementation would have passed on the broken code.

So `test/helpers/postgrestShim.ts` is a PostgREST-shaped client over pglite. Each
request is one transaction under `SET LOCAL ROLE` + a JWT `sub`, exactly as
PostgREST serves one, so RLS and the deferred triggers apply as in production.
`shim.signInAs(sub)` is the test's "a real person signs in".

**The shim's own fidelity is pinned, not assumed.** Its `maybeSingle`/`single`
cardinality behaviour was read out of the installed `@supabase/postgrest-js`, and
four tests assert it against the shim directly — so if a future supabase-js
changes that contract, *those* tests fail rather than the suite quietly agreeing
with broken code. Unsupported operations (`.in()`, `.upsert()`, `.rpc()`, embedded
selects) **throw** rather than approximating: a shim that guesses produces green
tests about behaviour nobody implemented.

**NO TEAM IS SEEDED.** Not one `fantasy_teams` row is inserted anywhere in that
file. Every team in it is registered through the app's own path. Seeding teams
directly is what hid this defect.

The walk, as one test, in the order a person experiences it:
no team in this season reads **ABSENT** → so /team offers registration →
`registerTeam` with a name (untrimmed on purpose; it trims) → the row exists with
that name, that season, that owner → `fetchMyTeam` returns it and `teamIdentity`
yields a name to render **and a real string id** (the `undefined` that stopped
trades and selections loading) → a **second** registration is refused, and the
refusal is reported with the database's own message kept alongside, with the
table unmoved.

Also pinned: a team in **another** season is not returned for this one — the case
that matched the live symptom; registration refused once the season is locked
(D21/G10); and the four `teamIdentity` cases including the literal `[]` and
`{ id: undefined, name: undefined }`.

### 3.3 CONTROL RUN — mandatory, and reported in full. Three configurations.

| Configuration | Result |
|---|---|
| **A** — data layer reverted to the exact pre-fix code (`unwrap` + `?? null`) | **2 failed**, 20 passed. Both: `AssertionError: expected [] to be null` |
| **B** — data layer fixed, `teamIdentity` reverted to the pre-fix inline ternary | **2 failed**, 20 passed. Both: `AssertionError: expected { id: undefined, name: undefined } to be null` |
| **C** — both reverted, i.e. the code exactly as it stood at main cb37e99 | **4 failed**, 18 passed |
| **Fixed** | **22 passed** |

Each layer of the fix is independently capable of failing, and each fails with
the defect's own shape rather than a generic assertion. B's message is the object
your hypothesis predicted, produced by the code rather than by me.

A note on method, because the first draft was weaker and I do not want it taken
for the final one: in an earlier version the four shim-fidelity tests *also*
failed under control A, because they leaned on a row the walk test created.
That coupling made the signal ambiguous — a reader could not tell which failures
were the defect. Every test in the file now creates its own data (the
fidelity block has its own season and registers its own two teams), so control A
now fails **exactly** the two tests that describe C16.

### 3.4 Item 3 — the audit (MUST). VERIFIED.

Every `.maybeSingle()` and `.single()` in `app/` and `src/` — 7 sites, all of
them named so the audit is auditable:

| # | Site | Call | On no row | Distinguishes absent? | Verdict |
|---|---|---|---|---|---|
| 1 | `teamQueries.ts` `useMyTeam`/`fetchMyTeam` | `maybeSingle` + `unwrap` | was `[]` | **no** | **C16 — BROKEN, FIXED** |
| 2 | `teamQueries.ts` `useLeagueConfig`/`fetchLeagueConfig` | `maybeSingle` + `unwrap` | `[]` → `[].config` is `undefined` → `?? null` → `null` | by accident | **accidentally correct — HARDENED** |
| 3 | `queries.ts:152` `useIsManager` | `maybeSingle`, no unwrap | `data` is `null`; `res.data?.is_league_manager === true` → `false` | **yes** | fine — correct by construction |
| 4 | `queries.ts:294` `usePlayer` | `single` + `unwrap` | PostgREST **errors** (PGRST116); `unwrap` throws | **yes** — absence is an error, never empty | fine |
| 5–7 | `adminMutations.ts:77,143,200,279` (4 sites) | `single` after `insert().select()` | `ok()` throws `"…: the database returned nothing"` | **yes** — explicitly | fine |

Two observations worth carrying:

- **The adjacent case you named was exactly as you suspected.** `useLeagueConfig`
  survived only because its caller reached *through* the value for a property
  rather than testing the value itself. The next caller to write `if (row)` would
  have inherited C16 there. It is now `null` by construction, and pinned.
- **`ok()` in `adminMutations.ts` is the correctly-built counterpart to the broken
  `unwrap()`** — it throws on `data === null` explicitly. The same codebase
  contains both the right pattern and the wrong one; the wrong one is the older.

`src/` contains **no** `.maybeSingle()`/`.single()` at all — the engines never
touch the PostgREST client, which is G11's discipline holding.

### 3.5 Item 4 — team rename (SHOULD). BUILT; data layer VERIFIED.

`renameTeam` in `teamMutations.ts` + `TeamNameEditor` beside the team heading on
/team. **No migration.** It builds to the permission that already exists: 0004's
`fantasy_teams_update` policy admits the owner, and
`app.enforce_fantasy_team_participant_update` refuses `owner_profile_id` and
`season_id` changes from a non-manager. Name-only is therefore the *database's*
rule — nothing is re-implemented client-side, and refusals go through the
existing `translateRefusal`.

`.select()` on the update is load-bearing, for the reason `adminMutations`
documents: under RLS an UPDATE the policy excludes is a **silent no-op** — zero
rows, no error — so asking for the row back turns "not permitted" into a visible
failure rather than a false success. Pinned: a stranger's rename is refused and
the name is unmoved.

Pinned and worth knowing: **a rename still works after the season locks.** 0002's
`trg_fantasy_teams_registration_lock` is `BEFORE INSERT OR DELETE` only. D21
freezes the team *set* because fixtures are derived from it; it does not freeze
the labels on it, and home/away comes from circle orientation, never from the row.
Registering into that same locked season is still refused — both halves are tested.

### 3.6 Item 5 — ask people for their name (SHOULD). BUILT; data layer VERIFIED.

`app/auth/displayName.ts` + `app/auth/DisplayNamePrompt.tsx`, mounted in
`RequireAuth`. **No migration.** It writes through 0004's existing
`GRANT UPDATE (display_name, photo_path)` and `profiles_self_update`
(`id = auth.uid()`), so a participant can set their own display name and nothing
else — `is_league_manager` is in no authenticated grant and remains unsettable
from here even by a manager (0004 Decision 4). **Supabase-side sign-up
provisioning was not touched**, as instructed.

`needsDisplayName()` is a plain function so the trigger is pinned rather than
discovered in production: it asks when the name is missing, blank, or still
contains an `@`. An `@` is the whole test — it cannot appear in a name someone
typed and is present in every address. Deliberately not a full email regex: a
malformed address is exactly as exposing as a well-formed one. An email is also
refused *as* a display name, since accepting one would defeat the point.

Pinned: the write works and is verified against the table; a stranger cannot set
someone else's name; and a user with **no profile row** reads as absent and is
never prompted — the C16 absent-vs-empty distinction doing load-bearing work
somewhere other than /team, where folding the two together would have locked
every un-provisioned user out of the entire app.

---

## 4. WHAT DID **NOT** CHANGE

- **No migration.** `git status supabase/` is empty. Standing Rule 9a and
  Standing Rule 10 are satisfied trivially — there is nothing to add an apply
  step for, so MANAGER_VERIFY is untouched. Every permission items 4 and 5 use
  already existed in 0004, exactly as the kickoff said.
- **`src/` is untouched in full** — `git diff -- src` is empty, so G11's
  `git diff -- src/engines` check is empty. No economy constant moved, and the
  engines carry none.
- **`app/routes/admin/**` untouched.** No widening into the admin screens.
- **`DEFINITION_OF_DONE.md` untouched** — v1.2 remains FROZEN (Law 3). No gate
  moved, none was redefined.
- **The demo season's data was not touched.** Nothing in this slice reads or
  writes it; it remains the G10 evidence.
- **`unwrap()`'s body is byte-identical.** Only its doc comment changed.
- **No new dependency.** `package.json` and `package-lock.json` are untouched. No
  jsdom, no React testing library, no browser driver — installing one was out of
  scope and I did not do it. I agree with that call: see §8.2.
- **`app/lib/queries.ts` untouched** — it is outside the fences, and the audit
  found both of its sites already correct, so there was nothing to fix there.
- **`app/styles/team.css` untouched** — outside the fences, so the rename control
  is placed with an inline style and reuses existing classes (`btn-ghost`,
  `register-card`, `picker-search`) rather than adding CSS.

---

## 5. ARTIFACTS, BY NAME AND FINGERPRINT

Commit **59f3c07** on `claude/affectionate-heisenberg-ufpi40`, built on main
**cb37e99**. Fingerprints are `git hash-object`, first 12.

| Artifact | Fingerprint | Lines | What |
|---|---|---|---|
| `app/lib/teamQueries.ts` | `5af1abd12618` | 419 | **the C16 fix**: `unwrapMaybe`, `fetchMyTeam`, `teamIdentity`, `fetchLeagueConfig` |
| `app/lib/useTeamState.ts` | `61eb5ba9767e` | 220 | one derivation via `teamIdentity` |
| `app/lib/teamMutations.ts` | `710248f93d31` | 536 | `renameTeam`; one-team-per-season refusal |
| `app/routes/Team.tsx` | `389406219c6c` | 497 | rename control beside the heading |
| `app/auth/RequireAuth.tsx` | `f076cb39ae1b` | 28 | mounts the prompt |
| `app/auth/displayName.ts` | `6a8e2a44d2f7` | 112 | **new** — read/write/decide display name |
| `app/auth/DisplayNamePrompt.tsx` | `9dd456b6a779` | 133 | **new** — the prompt |
| `app/components/team/TeamNameEditor.tsx` | `b204a70adfd9` | 100 | **new** — rename control |
| `test/c16.registration-path.test.ts` | `db1ecd34373b` | 540 | **new — the verifying artifact**, 22 tests |
| `test/helpers/postgrestShim.ts` | `3acd25994f53` | 316 | **new** — PostgREST-shaped client over pglite |
| `tsconfig.json` | `e08c43a0c0ef` | 26 | `include` → `["src"]` (see §8.1) |
| `tsconfig.app.json` | `bc04c3f615ae` | 21 | `include` gains `"test"` (see §8.1) |
| `DECISION_LOG.md` | `d5f603632cd5` | 677 | **C16 recorded** with cause, control run, why it survived |

---

## 6. GATES

**No DoD gate moved. DEFINITION_OF_DONE v1.2 remains FROZEN and UNCHANGED.**

**Test counts, MEASURED not inherited.** Per the kickoff, I ran the suite before
changing anything:

- **BASE (measured on cb37e99, before any edit): 38 files, 348 tests, all green.**
- **FINAL: 39 files, 370 tests, all green.** +1 file, +22 tests.

A deliberate note, because the kickoff flagged this exact trap: the August report's
claim of 348 **happens to coincide** with the measured base. I am telling you it
coincides rather than letting the match imply I trusted it — the number above came
from a run on this checkout, and the hearsay was not consulted to produce it.

| Check | Result |
|---|---|
| **G13 auth boundary** — required re-run, since items 1/4/5 touch identity and ownership | **green, 11/11**, including case 10 (second self-registration refused on the UNIQUE constraint) |
| **G11 config/economy** | green; `git diff -- src/engines` **empty** |
| Full suite | **370/370 green**, 39 files |
| `npm run build` (`tsc -p tsconfig.app.json --noEmit && vite build`) | clean; 174 modules; the 500 kB chunk warning is pre-existing (F4) |
| `npx tsc --noEmit` (root, pure-node program) | clean |

**Deployment.** Per Standing Rule 8: push is to the harness branch and you merge
to main via PR. Vercel deploys main automatically, and **this slice has no
database half at all** — no migration, no config change, no data change — so
**the merge is the whole deployment.** Nothing to apply, nothing to probe
afterwards. That is the one thing standing between you and inviting participants,
subject to §7.

---

## 7. OPERATOR ACCEPTANCE STEP — REQUIRED BEFORE ANYONE IS INVITED

Not automatable in this harness (no browser driver, no jsdom, no React testing
library), so this half is yours. Use a **fresh email that has never had a team**.
The words below are what you should see; you should not have to interpret anything.

1. **Sign in** with the fresh email.
2. **NEW, and expected first (item 5):** a full page headed
   **"What should everyone call you?"**, then a card **"Choose your display name"**
   whose text reads *"Every player in this league can see this name … Right now
   yours is `<your email address>`, which is the address you signed in with,
   because nothing has ever asked you."*
   Type a name → the button reads **"Save name"** → click it.
   *(There is also a **"Not now"** button. It is deliberate, and it should work —
   it must never be possible to get stuck on this screen.)*
3. **Go to /team.** Expect the heading **"My Team"**, the Squad/Trades tabs, then
   a card headed **"Register your team"** with the text *"One team per person per
   season. The name is cosmetic and can be changed later…"*, a box placeholdered
   **"Team name"**, and a **"Register"** button.
   **THIS IS THE DEFECT'S TEST.** Before this fix you got the squad builder here,
   under a blank heading, and no registration form at all.
4. **Type a team name and click Register.** The button reads **"Registering…"**.
5. **Expect the page to become your team:** the `<h1>` is **your team name, not
   blank**, with a **"Rename team"** button beside it; below it **"Build your
   squad"**, and a line reading **"Picked 0 of 9"** — 9 per D32. The cap figure
   shown is whatever `seasons.config.squad.cap` currently holds (the 285,700
   placeholder written on 15/09; the lock recomputes and overwrites it).
6. **Confirm the registration form is gone.** One team per person per season. If
   you ever do see the one-team refusal it reads **"You already have a team in
   this season."**
7. **Item 4, while you are here:** click **"Rename team"** → a card
   **"Rename your team"** → change the name → **"Save name"** → the heading
   updates to the new name.

If step 3 shows a squad builder instead of the registration form, **stop and tell
me** — that would mean the cause is not fully closed and I should not have said it was.

---

## 8. OPEN HYPOTHESES AND JUDGEMENT CALLS

**8.1 — The one change outside the named fences, needing your ruling.**
My new test imports `app/` code (that is the point of it — it drives the real
`registerTeam`). That dragged `app/` files into the root `tsconfig.json` program,
which deliberately withholds `jsx`, `DOM` and `vite/client` types, and
`npm run typecheck` — **clean on cb37e99** — started failing. I would not leave a
check I broke.

Two ways to fix it, and I took the second:
- Add `jsx`/`DOM`/`vite` to `tsconfig.json`. **Rejected:** `src` is in that
  program, so this would have ended the only check that the engines compile
  against pure node libs with no DOM. They run under `tsx`; that check has value.
- **Taken:** move `test` from `tsconfig.json` into `tsconfig.app.json`. The suite
  now genuinely spans `app/` + `src/`, so the app program is its proper home.

Net: `src` keeps its pure-node check (`npx tsc --noEmit`); tests are still
typechecked, now by `npm run build`, which is what Vercel runs. Both programs are
clean. **What you lose:** `npm run typecheck` alone no longer covers `test/`. The
reasoning is written into `tsconfig.json` as a comment at the point of surprise.
If you would rather I had not touched build config, say so and I will find another
way — it is two lines and fully reversible.

**8.2 — Rendering is still untested, and that is the honest residual risk.**
I agree with the kickoff that installing a browser harness was out of scope, and
I did not. But be clear about what that leaves: items 1–3 are verified at the data
layer and at the decision `Team.tsx` branches on, **not** at the render. The
jump from "`teamIdentity` returns null" to "the registration form appears on
screen" is covered by §7 and by nothing else. A component harness is the
single highest-value thing this suite still lacks, and it is now the *only*
untested link in the participant's most important path. Candidate for V-NEXT or
the polish slice — your call, and I did not act on it.

**8.3 — The shim is a faithful stand-in, not supabase-js.** Its cardinality
contract is read from the installed library and pinned by four tests, and
everything it does not implement throws. But it is still a stand-in: it does not
exercise HTTP, PostgREST's query parser, or embedded resource selects. It is the
right tool for *this* defect, which lived in the return-shape seam. It would not
catch a defect in, say, `usePool`'s embedded `price_history(...)` select.

**8.4 — A14 is still not committed to the repo.** `DECISION_LOG.md` in this
checkout still lacks C14, C15, D31–D34 and Standing Rule 10; I recorded C16 with
a numbering note saying the gap is the uncommitted block, not a missing item. I
did **not** commit A14 on your behalf — that is a governance action, not this
slice's work. Worth doing soon: this is the second slice where the log a builder
reads is behind the log you hold, and the 15/09 finding was about exactly that
class of drift.

**8.5 — Two small things I chose not to do,** rather than widen:
- `DisplayNamePrompt` and `useIsManager` each read the caller's own `profiles`
  row, so a signed-in user now makes two reads of one row. Coupling them means
  editing `app/lib/queries.ts`, which is outside the fences. Cheap polish win.
- `F7` (S-C's dead fixture-disagreement banner) is still in `Team.tsx`. I was in
  that file, but deleting it is not this slice's job and it is already logged.

**8.6 — Not a defect, but you should know:** a team named `""` would render a
blank heading again. `teamIdentity` accepts an empty *string* name deliberately —
rejecting it would hide a real team behind a registration form whose submission
would then be refused as a duplicate, which is worse. Both `registerTeam` and
`renameTeam` refuse blank names, so `""` is not reachable through the app.

---

## 9. NEXT ACTION

1. **You:** review and merge 59f3c07 to main. Vercel deploys it; there is no
   database half, so the merge is the deployment.
2. **You:** run §7 on a fresh email. ~2 minutes. This is the gate on inviting anyone.
3. **You:** rule on §8.1 (the `tsconfig` change).
4. **Then:** invite participants. Round 1 locks 11:00 Sydney, Saturday 19/09/2026.
5. **Soon, not blocking:** commit the A14 block (§8.4), and decide on §8.2.

---

## 10. BURN REPORT

One session: hypothesis verified link-by-link before any edit, the one-line fix
taken as a second helper so no list call site was put at risk, a 22-test
end-to-end registration path driving the app's own code against pglite with a
three-way control run, all 7 `maybeSingle`/`single` sites audited and the two
broken-or-accidental ones closed, plus items 4 and 5 built on permissions that
already existed — 348 → 370 tests green, G13 green, no migration, no new
dependency, `src/` untouched.

# REPORT — S-H: SELF-SERVICE SIGN-UP

State stamp: built on `main @ 9a2bb82` (S-G merged), branch
`claude/dazzling-cerf-qyslwo`. Governance: KICKOFF v1.3 · DEFINITION_OF_DONE v1.2
(FROZEN, unmoved) · DECISION_LOG v2.3 (this slice records D35).
Status: **BUILT + VERIFIED** on everything the harness can reach; **one operator
acceptance step and one operator configuration step remain** before it is
APPROVED. Deadline context: round 1 locks 11:00 Sydney, Saturday 19/09/2026.

---

## PLAIN READ FOR THE OPERATOR

People can now create their own account. The Magic link tab is gone — it never
worked and never could, because it needs an email this project cannot send — and
in its place is a **Create account** tab: email, password, confirm password, and
you are straight into the app. No email is sent and none needs to be.

Create account is the tab that opens first. Sign in is one click away and
unchanged.

The real work was the things that go wrong. If someone registers, forgets, and
registers again, they are told *"That email already has an account. Switch to the
Sign in tab and use your password — if you've forgotten it, ask Luke to reset it
for you."* — not an error. The Sign in tab now says out loud that there is no
reset email and that people should ask you. And if the confirmation setting is ever
switched back on, sign-up will not silently break: it says the account was made
but cannot be used yet, and names you as the person who can fix it.

**Two things are still yours to do**, and the first one blocks everything:

1. **Turn "Confirm email" OFF** in Supabase → Authentication → Sign In /
   Providers → Supabase Auth. ("Allow new users to sign up" is already ON.) With
   it ON, a new account is created but no session comes back and a confirmation
   email is queued that cannot be delivered. The code handles that case rather
   than assuming you have done it — but until you do, nobody gets in.
2. **Walk the acceptance step** in the section of that name below: a private
   window, an address never used before, through to a named team.

---

## OPERATOR DECISIONS THIS SLICE RESTS ON

Carried in as rulings, not re-opened, and now recorded as **D35**:

- **Email delivery is OFF and staying off.** Supabase's built-in sender only
  delivers to project-team addresses; a custom sender needs a verified domain you
  do not have, or another account to configure.
- **Google sign-in was considered and declined** — it needs credentials created
  in Google's console and excludes anyone without a Google account.
- **Email + password, self-service, no confirmation step.**
- **Accepted consequence: no self-service password reset.** Forgotten passwords
  are reset by you in the Supabase dashboard.
- **Recorded consequence: anyone with the URL can create an account**, and is
  then inside data classed INTERNAL under D17, in a pool containing juniors.
  There is no invitation, allowlist or confirmation standing in the way. You have
  been told and have chosen speed for round 1. A join code on the sign-up form is
  the cheap remedy if you later want one; it is **not** in this slice.

---

## WHAT CHANGED

**`app/routes/Login.tsx`** (modified) — `type Mode` is now `"create" | "password"`.
The `signInWithOtp` branch and its "check your inbox" state are deleted outright,
not hidden. The Create account tab collects email + password + confirm and calls
`supabase.auth.signUp`; on success the session lands and `AuthProvider`'s
`onAuthStateChange` admits the person exactly as password sign-in does today.
Password sign-in is byte-for-byte the same call it was.

**`app/auth/signUpOutcome.ts`** (new) — the decision layer, as plain total
functions over what `signUp` hands back. No network, no React, no `supabase`
import, so the branches that decide what a person is told are testable in a
harness with no browser. Exports `classifySignUp`, `signUpMessage`,
`validateNewAccount`, `PASSWORD_MIN_LENGTH`.

**`test/d35.signup-outcomes.test.ts`** (new) — 18 tests over that module.

**`DECISION_LOG.md`** — D35 recorded; header moved to v2.3, with the v2.2 header
retained beneath it for provenance.

### Which tab opens first, and the justification

**Create account.** Round 1 locks 19/09, so for the first few days essentially
all traffic is people who have never been here — as the brief notes. A returning
participant signs in weekly and reads a two-tab strip without help.

The asymmetry of getting it wrong is what actually decides it. A returning person
who types into Create account is told *"that email already has an account —
switch to the Sign in tab"* and is one click from where they meant to be. A new
person who lands on Sign in gets *"Invalid login credentials"*, which names no
way forward at all. The default is chosen so the graceful failure is the one it
produces. It is one line to flip when traffic turns over.

### The failure cases, with the message chosen for each

| Case | Detected by | Message |
|---|---|---|
| **2a** already registered | error code `user_already_exists` / `email_exists`, **or** a no-error response whose user has `identities: []` | "That email already has an account. Switch to the Sign in tab and use your password — if you've forgotten it, ask Luke to reset it for you." |
| **2b** password too short | stated before submission from `PASSWORD_MIN_LENGTH`; server's `weak_password` mapped if it still fires | before: "At least 6 characters. There is no password reset email — if you forget it, Luke resets it for you, so pick something you'll remember." · after: "That password was rejected: *(server's wording)* Please choose another one." |
| **2c** succeeded, no session | no error, no session, user carries a real identity | "Your account was created, but this site cannot send confirmation emails, so it isn't active yet. Ask Luke to confirm it and then sign in." |
| **2d** passwords do not match | client-side, before the call | "The two passwords don't match. Retype them." |

Also mapped rather than shown raw: `signup_disabled`, `email_address_invalid`,
rate limiting, a failed fetch, and an unrecognised failure — which still names
you as the way forward rather than printing a bare error string.

### The library shape, read rather than assumed

The brief was explicit that the already-registered response depends on the
confirmation setting and has changed across versions. Read out of the installed
**@supabase/supabase-js 2.110.2 / @supabase/auth-js 2.110.2**, the same
discipline S-G applied to postgrest-js cardinality:

1. **`signUp` RETURNS auth errors; it does not throw them.** `GoTrueClient.signUp`
   catches anything `isAuthError` and returns
   `{ data: { user: null, session: null }, error }`. Only a non-auth throw
   escapes. A `try/catch` alone would treat every failure as a success — which is
   why the new code classifies the response instead of trusting it.
2. **Already registered, confirmations OFF** → `AuthApiError` with `code`
   `user_already_exists` (some builds/paths send `email_exists`). `handleError`
   in `lib/fetch.js` lifts that code from `data.code` under the 2024-01-01 API
   version the client always sends, falling back to `data.error_code`.
3. **Already registered, confirmations ON** → **no error at all.** GoTrue returns
   a fabricated user so addresses cannot be enumerated, and `_sessionResponse`
   passes it through as `{ session: null, user }`. The tell is `identities: []`.
4. **Genuinely created, awaiting confirmation** → also `session === null` with a
   user object — but carrying the identity it was created with.

**Shapes 3 and 4 are indistinguishable except by `identities`.** That check is
the whole substance of 2a-vs-2c, and collapsing them would tell half the people
the exact reverse of the truth. An *absent* `identities` field is deliberately
not treated as empty: a response that omits it is not evidence of anything, and
guessing "already registered" there would turn a real new account into a dead end.

### Item 4 — the three-step first run

A brand-new participant meets, in order: **create account → "What should everyone
call you?" (the S-G `DisplayNamePrompt`, inside `RequireAuth`) → register a team
on /team.**

The order was wrong and has been fixed; no fourth screen was added. Sign-up
landed on `/` (the ladder), so after answering the name prompt a new person was
left on a league table with nothing signposting registration — three unrelated
interruptions ending nowhere. Sign-up now lands on `/team`. Because
`DisplayNamePrompt` sits inside the guard, it still intercepts first, and when the
name is saved the registration screen is what appears underneath it. The fix is
one piece of state in `Login.tsx` choosing the destination — **only the order**.
An ordinary sign-in still lands on `/` exactly as before.

This also keeps the change inside the fence: `/team`'s own registration screen
(S-G's work) was not touched.

---

## WHAT DID *NOT* CHANGE

- **No password reset flow was built.** There is no email to send one with.
- **No email provider, no dependency, no third-party sign-in button.** `npm ci`
  installed the existing lockfile unchanged; `package.json` and
  `package-lock.json` are untouched.
- **Password sign-in is unaltered** — your fallback for hand-made accounts.
- **Nothing under `supabase/migrations/`** (Standing Rule 9a/10). No migration
  was needed and none was written. Profile rows are provisioned at sign-up by the
  Supabase-side trigger, verified live on 15/09 (6 accounts, 6 profiles); that
  provisioning is out of scope and was not disturbed.
- **Nothing under `src/`, `app/routes/admin/`, `app/lib/teamQueries.ts` or
  `app/lib/useTeamState.ts`** — S-G's freshly settled files, left alone.
- **No DoD gate moved.** DEFINITION_OF_DONE v1.2 stays FROZEN (Law 3).

Fence check, the whole diff:

```
 M DECISION_LOG.md                      (explicitly instructed: record D35)
 M app/routes/Login.tsx                 OWNED
?? app/auth/signUpOutcome.ts            OWNED (app/auth/**)
?? test/d35.signup-outcomes.test.ts     OWNED (test/**)
?? REPORT_S-H_SELF_SERVICE_SIGNUP.md    (this report)
```

`git diff --stat -- src/engines` is **empty** — G11 holds, verified as CLAUDE.md
requires rather than asserted.

---

## ARTIFACTS BY NAME + FINGERPRINT

| Artifact | Lines | SHA-256 (first 16) |
|---|---|---|
| `app/auth/signUpOutcome.ts` | 204 | `88bdc936301bad0e` |
| `app/routes/Login.tsx` | 232 | `dae5a21901a136df` |
| `test/d35.signup-outcomes.test.ts` | 246 | `38b83f9737cc3a26` |

Fingerprints are the first 16 hex characters of `sha256sum` over the working tree
at the commit named in the state stamp; regenerate with
`sha256sum app/auth/signUpOutcome.ts app/routes/Login.tsx test/d35.signup-outcomes.test.ts`.

---

## TESTS, AND THE CONTROL RUN

**Base, measured before any change** (not taken from the brief, as instructed):
`npx vitest run` → **370 tests / 39 files passed**.
**Final:** **388 tests / 40 files passed.** Delta **+18 tests, +1 file**.

> Note on the harness: `node_modules/` was absent at session start and `npm ci`
> was run to restore it from the committed lockfile. No dependency was added,
> changed or upgraded.

**G13 AUTH_BOUNDARY re-run and green — 11/11**, required because this slice is
entirely identity. It is unchanged by design: RLS is the database's job, and
sign-up adds a *route in*, not a new privilege. Nothing in `0004_rls.sql` moved,
so case 9 (a participant may set their own `display_name` and nothing else) and
case 6 (anon reads nothing, D17) still hold for accounts created this new way.

`npm run build` (tsc `--noEmit` + vite) passes. The only warning is the
pre-existing 500 kB chunk notice already recorded as follow-up **F4**.

### Control run — each test shown FAILING against deliberately broken code

The C16 lesson: a test that passes on the unbuilt code proves nothing. Four
mutations, each reverted immediately after.

| # | Mutation to `signUpOutcome.ts` | Result |
|---|---|---|
| 1 | Remove the `identities` split, so both no-session shapes return `needs-confirmation` | **2 failed** — `expected { kind: 'needs-confirmation' } to deeply equal { kind: 'already-registered' }` |
| 2 | Remove the `ALREADY_REGISTERED_CODES` branch | **1 failed** — `expected { kind: 'unknown', …(1) } to deeply equal { kind: 'already-registered' }` |
| 3 | Remove the password-confirmation match from `validateNewAccount` | **1 failed** — `.toMatch() expects to receive a string, but got object` |
| 4 | Add an invented client rule (require a capital letter) the server does not share | **4 failed** — `expected 'Use at least one capital letter.' to be null` |

**Mutation 2 is worth reading, because on its first run it PASSED 17/17 on
knowingly broken code.** The test was asserting the confirmations-OFF shape with
the message *"User already registered"*, and a last-resort message match was
quietly classifying it — so the test proved the fallback worked, not the error
code the brief asked to be pinned. The test now uses a neutral message
(*"Email address is taken"*) so the **code alone** can classify it, and a separate
test covers the message fallback. It fails correctly under mutation 2 now.

That is precisely the failure mode C16 exists to record, caught by the control run
rather than by an operator, and it is the reason the control run is not a formality.

Two other defects the tests caught in the built code, both fixed: the
`unknown` outcome printed a bare `Sign-up failed: <detail>` naming no way
forward, and an embedded server string with no trailing full stop ran into the
next clause.

### What the suite covers, and what it cannot

Covered: the error mapping of item 2 as a plain function over auth responses, with
both already-registered shapes pinned to what the installed library actually
returns; the no-session-returned branch of 2c, including that it is *not*
mis-read as already-registered; password confirmation matching; and that the
client adds no rule the server does not share.

**Not covered: rendering.** The harness has vitest, pglite and tsx — no browser
driver, no jsdom, no React testing library — so "open /login and see the Create
account tab" is not testable today, and installing a harness to make it so was out
of scope. That half is the operator acceptance step below, exactly as S-G handled
the same limit.

---

## OPERATOR ACCEPTANCE STEP

**Do step 1 of the plain read first** — "Confirm email" OFF — or this will stop at
the third line with the 2c message.

In a **private/incognito window**, at the deployed site, with **an email address
never used on this project before**:

1. The login page opens on **Create account** (tab selected, heading *"Create an
   account to pick your team."*). The other tab reads **Sign in**.
2. Below the password fields: *"At least 6 characters. There is no password reset
   email — if you forget it, Luke resets it for you, so pick something you'll
   remember."*
3. Type a password and a **different** confirmation → **"The two passwords don't
   match. Retype them."** No network call is made.
4. Fix the confirmation, use a password of **5 characters** → **"Your password
   needs to be at least 6 characters."**
5. Use a valid password and submit. The button reads **"Creating account…"** and
   you land — with no email, no confirmation screen — on **"What should everyone
   call you?"**
6. Enter a name, **"Save name"** → you arrive directly on **/team**, on the
   registration form, *not* the ladder. Register a team and name it.
7. Sign out. Go to **Create account** and submit **the same address again** →
   **"That email already has an account. Switch to the Sign in tab and use your
   password — if you've forgotten it, ask Luke to reset it for you."**
8. Switch to **Sign in**. The line beneath reads *"Forgotten your password?
   There's no reset email on this site — ask Luke and he'll set you a new one."*
   Sign in with the password from step 5 → you land on the **ladder**, and are
   **not** asked for a name again.

If step 5 instead says *"Your account was created, but this site cannot send
confirmation emails…"*, then "Confirm email" is still ON — that message is the
2c defence working, and the fix is the setting, not the code.

---

## GATES MOVED

**None.** DEFINITION_OF_DONE v1.2 remains FROZEN (Law 3).

- **G13 AUTH_BOUNDARY — re-run, GREEN (11/11).** Required by the brief because
  this slice is entirely identity.
- **G11 — holds.** `git diff -- src/engines` is empty; no economy constant exists
  in this slice's code.

---

## OPEN HYPOTHESES

1. **The open door is the live risk, and it is now real rather than theoretical**
   (D35d). With sign-up self-service and unconfirmed, anyone with the URL is
   inside INTERNAL data including a pool with juniors. Accepted for round 1 by
   ruling; a join code on the form is the cheap remedy. **Not acted on — this is
   recorded, not escalated, because you have already ruled on it.**
2. **The already-registered message assumes the address is the person's own.**
   Someone mistyping a colleague's address is told an account exists for it,
   which is a (small, deliberate) enumeration surface. It is the price of ruling
   (a) — the alternative is the silent obfuscated response, which strands the
   far more common forgot-I-registered case. Flagged, not changed.
3. **Rate limiting is now reachable from the sign-up form.** GoTrue rate-limits
   `/signup` per IP. Several people registering from one clubhouse Wi-Fi could
   trip it; the message says to wait a minute. Untested against the live project
   — worth watching on the first busy evening.
4. **`PASSWORD_MIN_LENGTH` mirrors the project setting; it does not read it.**
   Supabase exposes no client API for the minimum. If you raise it in the
   dashboard, the form's hint will understate it until that one constant is
   updated — the server still rejects correctly and the rejection is mapped and
   shown, so the failure is cosmetic, not a lockout. The constant carries a
   comment saying exactly this.
5. **Not verified against the live Supabase project.** Every library shape here
   was read from the installed source and pinned in tests; none was exercised
   against your real GoTrue instance, which the harness cannot reach. The
   acceptance step is what closes that gap.

---

## NEXT ACTION

1. **Operator:** turn **"Confirm email" OFF** (Supabase → Authentication → Sign In
   / Providers → Supabase Auth). This blocks everything else.
2. **Operator:** merge the PR for `claude/dazzling-cerf-qyslwo`. **Vercel deploys
   `main` automatically and this slice has no database half — so the merge is the
   whole deployment.** Nothing to run, no migration to apply.
3. **Operator:** walk the acceptance step above. On success this slice moves
   BUILT/VERIFIED → **APPROVED**.
4. **Governance, not this slice:** the **A14 block** (15/09/2026, defining C14 and
   C15) is still uncommitted to `DECISION_LOG.md`. S-G flagged this and it remains
   open; the C16 numbering note in the log still points at the gap.

---

## BURN REPORT

One session, one slice, no parallel sessions, built against merged `main @ 9a2bb82`;
scope as briefed with nothing widened, no dependency added, no migration written,
and no escalation needed — the one thing worth your attention is the control run's
mutation 2, which caught a test that was proving the wrong thing.

---

State stamp for the handoff: branch `claude/dazzling-cerf-qyslwo`, based on
`main @ 9a2bb82`; suite 388/388 green; G13 green; DoD v1.2 FROZEN and unmoved;
DECISION_LOG at v2.3 with D35 recorded. Status **BUILT + VERIFIED**, pending the
operator configuration and acceptance steps above.

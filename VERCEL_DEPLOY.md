# VERCEL_DEPLOY — read-only league views, deploy runbook

State-stamp: as-of 2026-07-09 · deploys the **frontend league-views slice** (login · ladder +
overall leaderboard · player price list · player profile · rounds/fixtures) · builds against
KICKOFF v1.2 / DoD v1.2 / DECISION_LOG v1.7. This runbook takes an operator from a **fresh
Vercel account** to a **working preview URL** rendering live Supabase data, dashboard-first.
It assumes migrations `0001–0004` are already applied to the live project (per
`SUPABASE_LIVE_VERIFY.md`) — the app only READS; RLS does all authorization.

Live project (public by design): URL `https://gibdcruufikkhgpswrpa.supabase.co`, publishable
key `sb_publishable_0C2mIzmhtZtK24_vFEtjHA_nR5epg8j`. These are safe to ship to the browser;
the anon role reads **nothing** when logged out (D17).

---

## ⚠️ THE TWO GOTCHAS

1. **`VITE_` env vars are baked in at BUILD time, not read at runtime.** Vite inlines
   `import.meta.env.VITE_*` into the JS bundle when it builds. If you add or change an env var,
   you **must trigger a new deployment** for it to take effect — editing it in the dashboard
   does nothing until the next build. Set them **before** the first deploy (Step 4).
2. **Magic-link sign-in needs the Vercel URL whitelisted in Supabase.** A magic link redirects
   back to your app; Supabase only allows redirect to URLs on its **Redirect URLs** allow-list.
   Miss this and password sign-in still works, but magic links bounce. Fix in Step 5.

---

## Step 1 — prerequisites (what must already be true)

- **Migrations `0001–0004` applied** to the live Supabase project (SQL editor), per
  `SUPABASE_LIVE_VERIFY.md` Steps 1–3. G13 (auth boundary / RLS) live-confirmed.
- **The repo is on GitHub** and the league-views branch is merged to your default branch
  (`main`). Vercel deploys from a Git branch.
- **At least one test user with email + password** exists (Supabase → Authentication → Users →
  *Add user* → *Create new user*, tick *Auto Confirm*). You will log in as this user to see
  data. For a populated **ladder**, you want **four** such users (Step 2 needs their ids).

## Step 2 — seed the demo season (Supabase SQL editor)

The read views render whatever the live DB holds. To see a populated ladder / prices / scores,
paste the generated **seed pair** — raw truth then engine-computed derived state. Both are
idempotent (safe to re-run) and pass the live trigger stack legitimately (future lock, legal
within-cap squads, a captain per team). Regenerate anytime with `npm run seed:generate`.

1. In **Authentication → Users**, copy the **User UID** of four test users (call them A, B, C, D).
2. Open `supabase/seed/seed_raw.sql`. **Find-replace** the four owner tokens with those UIDs:
   `__OWNER_A__` → A's UID, `__OWNER_B__` → B, `__OWNER_C__` → C, `__OWNER_D__` → D.
   (Each fantasy team needs a distinct owner profile — the FK is to `profiles.id` = `auth.users.id`,
   which the signup trigger created. Fewer than four users? Delete whole team blocks from the
   `fantasy_teams`/`selections`/`trades` inserts to match.)
3. Paste the edited `seed_raw.sql` into the SQL editor and **Run**. **Expect:** `COMMIT` with no
   error. A trigger rejection here is a real finding — capture it, do not bypass.
4. Paste `supabase/seed/seed_derived.sql` and **Run**. **Expect:** `COMMIT`, no error.

> The player names/roles in the seed are **placeholder demo data** (real roles are pending
> operator input). Swap the `PLAYERS` table in `scripts/generate-seed.ts` for the real pool and
> re-run `npm run seed:generate` to regenerate the pair.

## Step 3 — import the repo into Vercel

1. Create a free account at **vercel.com** (sign in with GitHub — simplest, it wires Git access).
2. **Add New… → Project**. Vercel lists your GitHub repos; find the NSCC Fantasy repo and click
   **Import**. (First time: **Install** the Vercel GitHub app and grant it this repo.)

## Step 4 — configure the build + env vars (before the first deploy)

On the **Configure Project** screen:

- **Framework Preset:** Vercel auto-detects **Vite**. Leave it.
- **Root Directory:** leave as the repo root (`./`). The Vite app lives at the root.
- **Build Command:** `npm run build` (default). **Output Directory:** `dist` (default).
- **Environment Variables** — add both (Production + Preview + Development):

  | Name | Value |
  |---|---|
  | `VITE_SUPABASE_URL` | `https://gibdcruufikkhgpswrpa.supabase.co` |
  | `VITE_SUPABASE_ANON_KEY` | `sb_publishable_0C2mIzmhtZtK24_vFEtjHA_nR5epg8j` |

Then click **Deploy**. (Env vars set here are present for this first build — no redeploy needed.)

## Step 5 — point Supabase auth at the Vercel URLs

When the deploy finishes, Vercel shows your domain, e.g. `https://nscc-fantasy.vercel.app`
(and per-deploy preview URLs). In **Supabase → Authentication → URL Configuration**:

- **Site URL:** set to your production Vercel URL.
- **Redirect URLs:** add both your production URL and the preview wildcard, e.g.
  `https://nscc-fantasy.vercel.app/**` and `https://*-<your-team>.vercel.app/**`.

**Expect:** after saving, a magic-link email opened on the deployed site returns you signed in.
(Password sign-in works without this; the whitelist only gates the magic-link redirect.)

## Step 6 — the smoke test (this IS the slice's live verification)

Open your Vercel URL. Run each check; the **Expect** line is the pass condition.

**1. Logged-out sees only login (D17).**
   Visit the site in a private window. **Expect:** you land on `/login`; visiting `/`, `/players`,
   or `/rounds` directly redirects to `/login`. No league data is visible anywhere logged out.

**2. Sign in as a test user.**
   Use a Step-1 test user's email + password (or the magic link). **Expect:** you land on the
   **Ladder**; the top bar shows the nav (Ladder / Players / Rounds) and Sign out.

**3. Ladder + overall leaderboard render live data.**
   **Expect:** the ladder lists the four demo teams sorted by points (2·wins + ties), points-for
   tiebreak, under the navy broadcast header; the overall leaderboard lists totals below.

**4. Player price list.**
   Open **Players**. **Expect:** ~11 players with role badges, current price, and green/red
   movement arrows (players who played the finalised match moved; the rest show a flat dash).

**5. Player profile.**
   Tap a player. **Expect:** avatar (monogram placeholder), a price-history sparkline + table,
   and per-match scores (bat/bowl/field/bonus/points) for the finalised round.

**6. Rounds & fixtures.**
   Open **Rounds**. **Expect:** each round shows its matches (with Final/Scheduled status) and the
   **derived** H2H fixtures, labelled **"provisional"** (the season is not yet locked, D21).

**7. Sign out.** **Expect:** back to `/login`; the protected routes are inaccessible again.

## Sign-off

When every **Expect** matches, record in the session report: *league-views slice deployed on
<date>, preview URL <url>, verified as test user <email>*. That satisfies the slice's definition
of done (all pages render live Supabase data as an authed user; logged-out sees only login;
`npm run build` clean; this runbook ends at a working preview URL). Any mismatch is a defect:
capture the page, the step, and the browser console, and hand back to the build seat.

> **Not in this slice** (named next): real player photos (`players.photo_path` + storage bucket +
> upload) ride with the manager-backend slice; no writes, no admin, no transcription (G12); the
> baseline B1 measurement comes later.

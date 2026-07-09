# SUPABASE_LIVE_VERIFY — G13 auth boundary, live confirmation runbook

State-stamp: as-of 2026-07-09 · covers `supabase/migrations/0001–0004` · builds against
KICKOFF v1.2 / DoD v1.2 / DECISION_LOG v1.7. Status per Law 1: **G13 = VERIFIED
(pglite-simulated auth); this runbook is the LIVE confirmation the operator runs.**

The gate suite proves G13 against pglite by *simulating* the Supabase auth context. This
document is the exact SQL the operator runs against the **real project** to confirm the
same boundary holds end-to-end. Everything here runs in the Supabase **SQL editor** unless
noted.

---

## ⚠️ THE ONE GOTCHA — the SQL editor bypasses RLS

The SQL editor connects as `postgres` (a **superuser**), and superusers **bypass RLS
entirely**. If you paste a policy check and run it as-is, it will *always* pass and prove
nothing. Every RLS check below is therefore wrapped in a transaction that drops to the real
API role first:

```sql
begin;
  set local role authenticated;                                   -- or anon
  set local request.jwt.claims = '{"sub":"<UID>","role":"authenticated"}';
  -- ... the probe ...
rollback;                                                          -- probes never mutate
```

`set local` is transaction-scoped, so `rollback` (or `commit`) restores your superuser
session. Probes use `rollback` so they leave no trace.

---

## Step 1 — apply the migrations (in order)

In the SQL editor, paste and run **in this order**, each as its own run:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_locks.sql`
3. `supabase/migrations/0003_selection_validation.sql`
4. `supabase/migrations/0004_rls.sql`

> The test-only Supabase shim (`test/helpers/pgliteDb.ts`) is **NOT** applied here. It only
> stands up, for pglite, what your real project already ships: the `anon` /
> `authenticated` / `service_role` roles and the `auth` schema with `auth.uid()`. On the
> real project those already exist, so `0004` — which references `auth.uid()` and grants to
> those roles — runs unchanged.

Sanity: `0004` should report success with no error. If it complains that `auth.uid()` does
not exist, your project predates the standard Supabase auth bootstrap — create it with the
standard definition before re-running `0004`:
```sql
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
```

## Step 2 — Supabase-only wiring (fulfils the 0001 forward-reference)

`0001` deliberately keeps `profiles.id` free of an `auth.users` FK so the migrations run on
pglite. On the real project, wire identity + auto-provisioning. This is **Supabase-only**;
do **not** add it to the migrations directory (it would break the pglite gate suite).

```sql
-- profiles.id IS auth.users.id.
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- Auto-create a profile row on signup (SECURITY DEFINER — runs as the owner, so it is the
-- only INSERT path into profiles; clients have none). is_league_manager defaults false.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

## Step 3 — the is_league_manager promotion (the ONLY write path, Decision 4)

There is **no client path** to set `is_league_manager` — not even for a manager. It is set
out-of-band here, as the superuser/service role. Replace the UID with the real manager's
`auth.users.id` (copy it from Authentication → Users):

```sql
-- RUNBOOK ENTRY: promote a user to league manager. Service-role / SQL-editor only.
update public.profiles set is_league_manager = true
 where id = '<MANAGER_UID>';
```

## Step 4 — seed a scratch verification season (as superuser)

Run once to give the checks something to act on. Replace the three `<..._UID>` with real
`auth.users` ids (a manager, and two ordinary users A and B who each have a profile row).
Keep the printed ids from the `returning` clauses.

```sql
-- scratch season, two rounds (one to be "open", one "locked"), six players, two teams.
insert into seasons (id, name, config) values
  ('11111111-1111-1111-1111-111111111111', 'G13 live check',
   '{"squad":{"teamSize":6,"roleMinimums":{"BAT":2,"WK":1,"BWL":2,"AR":1},"cap":1000000,"tradesPerRound":2},
     "pricing":{"alpha":0.2,"dollarsPerPoint":1000,"floor":9000,"roundingIncrement":100,"startingPriceGamesCap":4},
     "scoring":{"perRun":1,"perFour":1,"perSix":2,"perWicket":25,"perCatch":8,"perKeeperCatch":8,"perStumping":10,"perRunOutUnassisted":10,"perRunOutAssisted":5,"srBonusPoints":10,"srBonusMinStrikeRate":150,"srBonusMinBalls":10,"econBonusPoints":10,"econBonusMaxEconomy":3.0,"econBonusMinOvers":3}}'::jsonb);

insert into rounds (id, season_id, seq, name, lock_at) values
  ('22222222-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',1,'Open',   now() + interval '1 hour'),
  ('22222222-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',2,'Locked', now() - interval '1 second');

insert into players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active) values
  ('33333333-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pb1','PB1','BAT',false,50000,true),
  ('33333333-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','pb2','PB2','BAT',false,50000,true),
  ('33333333-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','pw','PW','WK',false,50000,true),
  ('33333333-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','pl1','PL1','BWL',false,50000,true),
  ('33333333-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','pl2','PL2','BWL',false,50000,true),
  ('33333333-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','pa','PA','AR',false,50000,true);

insert into fantasy_teams (id, season_id, owner_profile_id, name) values
  ('44444444-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','<OWNER_A_UID>','Team A'),
  ('44444444-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','<OWNER_B_UID>','Team B');
```

## Step 5 — the numbered live checklist

Run each block. The **Expect** line is the pass condition. `A` = `<OWNER_A_UID>`, `B` =
`<OWNER_B_UID>`, `M` = `<MANAGER_UID>`.

**1. Logged-out reads nothing (D17).**
```sql
begin; set local role anon;
  select * from profiles limit 1;
rollback;
```
Expect: **ERROR** `permission denied for table profiles`. Repeat for `players`, `ladder`,
`fantasy_teams` — each must error.

**2. Authenticated reads league data.**
```sql
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  select count(*) from players;                 -- Expect: 6
  select id, display_name, photo_path, is_league_manager from profiles;  -- Expect: all profile rows, 4 columns
  select is_league_manager from profiles;       -- Expect: OK (is_league_manager is readable)
  select email from profiles;                   -- Expect: ERROR permission denied (no such grant / column) — nothing beyond the enumerated set
rollback;
```

**3. Manager writes raw truth; a participant cannot.**
```sql
-- manager: OK
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<MANAGER_UID>","role":"authenticated"}';
  insert into players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
  values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111','probe','Probe','BAT',false,9000,true);
rollback;                                        -- Expect: INSERT 0 1 (succeeds), then rolled back
-- participant: REJECTED
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  insert into players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
  values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111','probe2','Probe2','BAT',false,9000,true);
rollback;                                        -- Expect: ERROR new row violates row-level security policy
```

**4. A participant writes their OWN team only.**
```sql
-- own team: OK
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  insert into trades (id, fantasy_team_id, kind, player_id, price, round_id)
  values (gen_random_uuid(),'44444444-0000-0000-0000-00000000000a','buy','33333333-0000-0000-0000-000000000001',60000,'22222222-0000-0000-0000-000000000001');
rollback;                                        -- Expect: succeeds
-- another team: REJECTED
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  insert into trades (id, fantasy_team_id, kind, player_id, price, round_id)
  values (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','buy','33333333-0000-0000-0000-000000000001',60000,'22222222-0000-0000-0000-000000000001');
rollback;                                        -- Expect: ERROR new row violates row-level security policy
```

**5. Derived tables take NO client writes; the service role writes them.**
```sql
-- participant AND manager are both denied (a manager is `authenticated`):
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<MANAGER_UID>","role":"authenticated"}';
  insert into ladder (season_id, fantasy_team_id, played, wins, losses, ties, points_for, ladder_points)
  values ('11111111-1111-1111-1111-111111111111','44444444-0000-0000-0000-00000000000a',0,0,0,0,0,0);
rollback;                                        -- Expect: ERROR permission denied for table ladder
-- the service role (what recompute uses) writes it:
begin; set local role service_role;
  insert into ladder (season_id, fantasy_team_id, played, wins, losses, ties, points_for, ladder_points)
  values ('11111111-1111-1111-1111-111111111111','44444444-0000-0000-0000-00000000000a',0,0,0,0,0,0);
rollback;                                        -- Expect: succeeds
```

**6. The bypass GUC is manager-only (requirement 3).**
```sql
-- non-manager + bypass into the LOCKED round -> still rejected:
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  set local app.locks_bypass = 'on';
  insert into trades (id, fantasy_team_id, kind, player_id, price, round_id)
  values (gen_random_uuid(),'44444444-0000-0000-0000-00000000000a','buy','33333333-0000-0000-0000-000000000001',60000,'22222222-0000-0000-0000-000000000002');
rollback;                                        -- Expect: ERROR ... is locked ... (G4)
-- manager + bypass -> the repair hatch lets it through:
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<MANAGER_UID>","role":"authenticated"}';
  set local app.locks_bypass = 'on';
  insert into trades (id, fantasy_team_id, kind, player_id, price, round_id)
  values (gen_random_uuid(),'44444444-0000-0000-0000-00000000000a','buy','33333333-0000-0000-0000-000000000001',60000,'22222222-0000-0000-0000-000000000002');
rollback;                                        -- Expect: succeeds
```

**7. Cross-read is lock-gated (Decision 3).** First seed a squad for Team B in the *open*
round as the superuser, then probe as A. (Run the seed outside a rollback so the probe can
see it; delete it in Step 6 cleanup.)
```sql
insert into selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) values
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001',true,false),
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002',false,false),
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000003',false,false),
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000004',false,false),
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000005',false,false),
  (gen_random_uuid(),'44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000006',false,false);

begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  select count(*) from selections where fantasy_team_id = '44444444-0000-0000-0000-00000000000b';
rollback;                                        -- Expect: 0 (Team B's open-round squad is hidden pre-lock)

begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<MANAGER_UID>","role":"authenticated"}';
  select count(*) from selections where fantasy_team_id = '44444444-0000-0000-0000-00000000000b';
rollback;                                        -- Expect: 6 (manager sees everything)
```
To confirm the post-lock flip, `update rounds set lock_at = now() - interval '1 second'
where id = '22222222-0000-0000-0000-000000000001';` then re-run A's probe → **Expect: 6**.

**8. profiles self-service.**
```sql
-- self display update: OK
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  update profiles set display_name = 'A renamed' where id = '<OWNER_A_UID>';
rollback;                                        -- Expect: UPDATE 1
-- self-set manager flag: REJECTED (Decision 4)
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  update profiles set is_league_manager = true where id = '<OWNER_A_UID>';
rollback;                                        -- Expect: ERROR permission denied ... is_league_manager
-- update someone else's profile: no-op (0 rows, RLS filters it)
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  update profiles set display_name = 'hax' where id = '<OWNER_B_UID>';
rollback;                                        -- Expect: UPDATE 0
```

**9. One team per profile per season (binding decision 2).**
```sql
begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<OWNER_A_UID>","role":"authenticated"}';
  insert into fantasy_teams (id, season_id, owner_profile_id, name)
  values (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','<OWNER_A_UID>','A second team');
rollback;                                        -- Expect: ERROR duplicate key value violates unique constraint
```

## Step 6 — cleanup

```sql
delete from selections where fantasy_team_id in
  ('44444444-0000-0000-0000-00000000000a','44444444-0000-0000-0000-00000000000b');
delete from ladder  where season_id = '11111111-1111-1111-1111-111111111111';
delete from seasons where id = '11111111-1111-1111-1111-111111111111';  -- cascades scratch rows
```

## Sign-off

When every **Expect** matches, record in the session report: *G13 live-confirmed on
<date>, project <ref>* — which flips G13 from "VERIFIED (pglite-simulated)" to
live-confirmed. Any mismatch is a defect: capture the block, the actual result, and the
acting role, and hand back to the build seat.

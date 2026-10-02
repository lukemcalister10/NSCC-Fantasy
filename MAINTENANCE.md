# NSCC Fantasy — current maintenance guide

Updated 2 October 2026. This guide supersedes the weekly operating instructions in
the pre-launch reports. Production: https://nsccfantasy.vercel.app/ . Manager: `/admin`.

## Publish a round

1. Open **Manager → Rounds**. Confirm the round, club matches and stored lock time.
   The manager's time inputs use Adelaide time; the participant display formats the
   stored timestamp. Do not infer a lock time from a default or a screenshot.
2. Enter or import the scorecards while the matches remain unfinalised. Include every
   player who actually played, including anyone who did not bat, bowl or field a dismissal.
   A named player with zero points played; someone absent from the lineup is DNP.
   Do not pad a team to eleven if it played with ten or twelve.
3. Verify names, runs/not-out/duck status, overs, wickets and fielding credits against
   the supplied club cards. Cricket overs use balls: `6.2` means 38 balls. Under the
   manager's existing ruling, missing fours, sixes and maidens contribute zero;
   do not invent those bonuses. Save and reopen each card to confirm it persisted.
4. Finalise each completed club match; mark a genuine abandonment accordingly.
5. Use **Manager → Recompute season**. This runs the complete season, including earlier
   rounds, through the same engines. Check the summary: expected new-round scores and
   prices should appear; previously frozen results should not change.
6. Review representative player scores and price movements, captain/DNP handling,
   team totals and the ladder. Resolve any problem before freezing.
7. Use **Rounds → End scorecard lockout…**. The coverage check compares committed cards,
   named players and published score/price entries. Expand the match reports, confirm
   the names and figures, and complete the final confirmation.
8. Confirm the round is frozen, its profile history is visible and the next round's
   trading state is correct. Freeze is permanent in the normal manager workflow.

The coverage check cannot determine whether a typed run total, wicket or player name
is correct. It also does not compare recomputed values against every raw statistic.
Manual verification in steps 3 and 6 remains necessary.

## During the week

- **Availability:** club data refreshes while the relevant screens are open, with a
  five-minute browser refresh interval and server cache. Manager entries override the
  feed for that round. Green/red dots are planning information; actual lineup inclusion
  determines whether the captain played when scores are calculated. Check feed errors
  and unmatched names in the registry if dots appear incomplete.
- **Players/photos:** edit via the manager registry. Names shown in the app may differ
  from club names; preserve registry identity and reviewed mappings. Player roles and
  season settings are protected after season lock.
- **Trades:** participants may submit several replacements together. Before lock they
  can undo the latest submission and should check captaincy afterwards. Trading remains
  blocked during the relevant lockout/results-pending states.
- **Help text:** edit `app/routes/Help.tsx`, build and deploy. Preserve operator-written
  wording. Values generated from configuration should agree with the active season.

## Connection and deployment checks

The manager's **Check database connection** action is read-only. It checks authentication,
manager permission, database connectivity and the configured TLS mode. It does not
recompute results and does not demonstrate that a backup can be restored.

The operator previously confirmed **Database connected. TLS certificate verified.**
Recheck after database credentials, certificates or deployment environments change.

| Setting | Scope | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser build | Public client configuration; RLS authorises data access |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Server (or Vite-name fallback) | Validate the signed-in caller |
| `POSTGRES_URL` | Server only | Database connection for recompute and connection checks |
| `POSTGRES_CA_CERT` | Server only | Public CA certificate used to verify the database TLS chain |
| `CLUB_API_KEY` | Server only | Club availability endpoint |

Never prefix database credentials or the club key with `VITE_`. Vite settings are
baked into the frontend at build time; changes require a new deployment. Check Production
and Preview independently. Avoid disabling TLS verification to make a connection work.

Before pushing: run `npm run build` and relevant existing tests. Use the full suite for
scoring, pricing, schema, permissions or trade changes. After pushing: check CI and the
Vercel **Production** record for the expected commit, Ready status and production domain.
Verify the affected signed-in page, direct URL/refresh and any profile overlay. Build
hashes may differ between local and hosted builds because environment values differ.

## Recovery and known limitations

- Headshot backup is covered by the operator's own copies; recovery work was declined.
- Database safeguards and verified TLS have been reviewed. An isolated database restore
  rehearsal is not recorded as completed. Check actual backup availability in Supabase
  before claiming recovery is covered; preserve raw scorecards, trades, selections,
  configuration and identity records, as well as any separately required storage/auth data.
- The current manager scorecard save replaces several tables through separate requests.
  It is not an atomic transaction: a failed request can leave a partially saved card.
  If saving fails, keep the source card, reopen and inspect the stored card, then repair
  and verify it before finalising/recomputing/freezing. An atomic save is outstanding work.
- Screenshot-to-review import is still an assisted workflow, not a self-service upload
  feature in the app. Round import helpers under local `scratch/` are not a supported
  public importer and should not be applied to another round without reviewing their guards.
- Frozen cards have no ordinary correction path. An exceptional correction requires
  deliberate investigation, a written reason and the documented override process;
  it must account for any trades made at published prices.

## Next useful UI work

The 2 October phone screenshots show readable Players/Ladder cards. Follow-ups are a
more compact My Team value summary, squad statistics visible alongside captain controls,
and investigation of the intermittent blank headshot shown for Mayur. These have not
been implemented as part of the loading/documentation update.

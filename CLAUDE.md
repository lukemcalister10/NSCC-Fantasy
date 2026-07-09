# Session notes — NSCC Fantasy (build seat)

Durable notes for the builder seat (Claude Code / Opus). Ephemeral sessions, so
anything worth keeping lives here or in the governance docs.

## Process rules (standing)

- **"Plan mode first" ends the turn.** When a task says to plan first, the plan
  presentation (plain read + restated decisions + proposed shape) is the WHOLE
  turn — stop and wait for the operator's explicit approval before writing any
  code, regardless of whether the harness enforces a plan mode. Presenting a plan
  and proceeding in the same turn skips the operator's checkpoint. (Operator
  correction, 09/07/2026.)

## Where things live

- Governance: `KICKOFF.md` (v1.1), `DEFINITION_OF_DONE.md` (v1.1, frozen gates),
  `DECISION_LOG.md` (v1.7, locked + open items). Read these first every session.
- Report per Standing Rule §1 in `README.md`: plain read + operator decisions on
  top, then what changed / what did NOT / artifacts / gates moved / open
  hypotheses / next action / burn report. Status vocabulary
  PROPOSED → DERIVED → BUILT → VERIFIED → APPROVED; "Done" is banned.
- The DATABASE is the gatekeeper (D16): economy/lock rules are Postgres
  triggers/constraints in `supabase/migrations/`, run against pglite in the gate
  suite. `src/engines/*` carry NO economy constants (Gate G11) — verify with
  `git diff -- src/engines` (must be empty) on any slice claiming they're untouched.

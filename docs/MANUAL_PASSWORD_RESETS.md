# Manual participant password resets

Manager → Account passwords (`/admin/accounts`). Select the participant, verify
their team and email and independently verify the request came from the owner.
Enter a unique password twice, confirm the account and submit. Share only the new
password privately. No email service is needed. Manager accounts are deliberately
excluded; this is not a way to recover a lost league-manager account.

Deployment: apply migration `0021_admin_password_reset_audit.sql`, then configure
`SUPABASE_SERVICE_ROLE_KEY` in Vercel **Production only** using the project's
existing privileged key. Never use a `VITE_` prefix, commit the key, or include it
in a frontend build. Existing public Supabase settings and server `POSTGRES_URL`
are also required. Deploy `api/admin-accounts.ts` and the account UI together.

Every request verifies the user's Supabase bearer token and the database manager
flag. Targets must own a fantasy team in the selected season and cannot be a
manager or the caller. The endpoint confirms the displayed email before writing.
It changes only the Auth password, not user identity, profile, team or league data.

Audit table: `public.admin_password_reset_audit`. Each attempt durably reserves a
request ID before invoking Supabase Auth. Its only fields are actor/target/season
IDs, status and timestamps. No passwords, hashes, keys, tokens or request bodies
are stored. Browsers cannot write this table; managers alone can read it.

Limits: five reserved attempts per manager in ten minutes and one per target per
minute. Reservation is transaction-locked in Postgres, not per-instance memory.
An identical successful request is idempotent. Pending/unknown/failed request IDs
cannot repeat the write. A network timeout or audit failure after the Auth call
can leave an uncertain result: ask the participant to try the new password before
attempting another reset. Do not claim a failed response means no change occurred.

Never enable request-body logging/APM capture for this endpoint. Password fields
are masked, cleared on submission and not passed to a React Query mutation cache.
The audit schema does not persist passwords. This does not mean browser developer
tools on the administrator's own device cannot inspect their outgoing request.

Live verification should use list/read-only checks and invalid reset requests.
Do not reset a real participant merely to test deployment. The administrator must
enter and submit actual new credentials themselves.

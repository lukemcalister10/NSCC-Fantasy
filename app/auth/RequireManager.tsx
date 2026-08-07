import { Outlet } from "react-router-dom";
import { useIsManager } from "../lib/queries";
import { Loading, ErrorState } from "../components/states";

/**
 * Chrome-level guard for /admin/*. THIS IS NOT THE AUTHORIZATION BOUNDARY —
 * migration 0004's RLS is (`app.is_manager()`, proven by G13, D16: "manager role
 * enforced in the DB, not the UI"). Its only job is that a non-manager who types
 * an /admin URL gets a plain refusal instead of a dead page or a crash from a
 * screen full of queries the database is about to reject.
 *
 * Mounted INSIDE <RequireAuth>, so a logged-out visitor is redirected to /login
 * before this ever renders (D17 — that redirect must not regress).
 *
 * Fail closed: while the flag is loading nobody is admitted, and a failed read is
 * a refusal, not an admission.
 */
export function RequireManager() {
  const { data: isManager, isLoading, error } = useIsManager();

  if (isLoading) return <Loading label="Checking access…" />;
  if (error) return <ErrorState error={error} />;
  if (!isManager) {
    return (
      <div className="page">
        <h1 className="page-title">Manager access only</h1>
        <p className="page-sub">
          This area is for the league manager. If you think you should have
          access, ask the league manager to enable it on your account.
        </p>
      </div>
    );
  }
  return <Outlet />;
}

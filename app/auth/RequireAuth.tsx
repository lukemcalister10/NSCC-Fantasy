import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { DisplayNamePrompt } from "./DisplayNamePrompt";

/**
 * Route guard (D17): every view sits behind login. Until the initial session
 * check resolves we render nothing (a brief blank) rather than flashing the
 * login page for an already-authed user. No session → redirect to /login,
 * preserving the intended path so magic-link/return lands the user back.
 *
 * IDENTITY COMES BEFORE CONTENT (item 5). `DisplayNamePrompt` sits inside the
 * guard, so it is reached by every authenticated view and only by authenticated
 * views — a person is asked for a name once per session before they can read a
 * league in which their email address is visible to everyone (0004's
 * profile SELECT grant, Law 11 / D17). It is NOT an authorization boundary, and
 * it never blocks: see the three non-trap conditions in that component.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <DisplayNamePrompt>{children}</DisplayNamePrompt>;
}

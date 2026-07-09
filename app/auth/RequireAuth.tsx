import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

/**
 * Route guard (D17): every view sits behind login. Until the initial session
 * check resolves we render nothing (a brief blank) rather than flashing the
 * login page for an already-authed user. No session → redirect to /login,
 * preserving the intended path so magic-link/return lands the user back.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

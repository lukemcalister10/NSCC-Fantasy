import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireManager } from "./auth/RequireManager";
import { AppShell } from "./components/AppShell";
import { Login } from "./routes/Login";
import { Ladder } from "./routes/Ladder";
import { Players } from "./routes/Players";
import { PlayerProfile } from "./routes/PlayerProfile";
import { Rounds } from "./routes/Rounds";
import { Team } from "./routes/Team";
import { Trades } from "./routes/Trades";
import { Help } from "./routes/Help";
import { AdminHome } from "./routes/admin/AdminHome";
import { AdminPlayers } from "./routes/admin/AdminPlayers";
import { AdminRounds } from "./routes/admin/AdminRounds";
import { AdminScorecards } from "./routes/admin/AdminScorecards";
import { AdminSettings } from "./routes/admin/AdminSettings";

/**
 * Route map. `/login` is the only unauthenticated page; everything else sits
 * behind <RequireAuth> inside the app shell (D17).
 *
 * /admin/* nests a second, pathless <RequireManager> layout route INSIDE
 * <RequireAuth>. Order matters: logged-out visitors are bounced to /login by the
 * outer guard before the manager check runs, so D17 holds for admin URLs too.
 * The manager check is chrome only — RLS (0004) is the authority (G13).
 *
 * The /team/* and /admin/* leaves are placeholders from the shared-chrome slice
 * (Standing Rule 9b): S-C replaces the team routes, S-A the admin routes.
 */
export function App() {
  const location = useLocation();
  const state = location.state as { backgroundLocation?: Location } | null;
  const backgroundLocation = state?.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation ?? location}>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Ladder />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerProfile />} />
          <Route path="/rounds" element={<Rounds />} />
          <Route path="/team" element={<Team />} />
          <Route path="/team/trades" element={<Trades />} />
          <Route path="/help" element={<Help />} />
          <Route element={<RequireManager />}>
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/players" element={<AdminPlayers />} />
            <Route path="/admin/rounds" element={<AdminRounds />} />
            <Route path="/admin/scorecards" element={<AdminScorecards />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {backgroundLocation ? (
        <Routes>
          <Route
            path="/players/:id"
            element={
              <RequireAuth>
                <PlayerProfileModal />
              </RequireAuth>
            }
          />
        </Routes>
      ) : null}
    </>
  );
}

function PlayerProfileModal() {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const shell = document.querySelector<HTMLElement>(".shell");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (shell) {
      shell.inert = true;
      shell.setAttribute("aria-hidden", "true");
    }
    dialog?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(-1);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (shell) {
        shell.inert = false;
        shell.removeAttribute("aria-hidden");
      }
    };
  }, [navigate]);

  function dismiss(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) navigate(-1);
  }

  return (
    <div className="player-modal-backdrop" onMouseDown={dismiss}>
      <div
        ref={dialogRef}
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Player profile"
        tabIndex={-1}
      >
        <button
          type="button"
          className="player-modal-close"
          aria-label="Close player profile"
          onClick={() => navigate(-1)}
        >
          ×
        </button>
        <PlayerProfile modal />
      </div>
    </div>
  );
}

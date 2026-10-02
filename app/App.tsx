import { lazy, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
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
import { DeferredPage } from "./components/DeferredPage";

// Download each page when it is opened, including the profile's historical stats.
const Ladder = lazy(() => import("./routes/Ladder").then((m) => ({ default: m.Ladder })));
const Players = lazy(() => import("./routes/Players").then((m) => ({ default: m.Players })));
const PlayerProfile = lazy(() => import("./routes/PlayerProfile").then((m) => ({ default: m.PlayerProfile })));
const Rounds = lazy(() => import("./routes/Rounds").then((m) => ({ default: m.Rounds })));
const Team = lazy(() => import("./routes/Team").then((m) => ({ default: m.Team })));
const FantasyTeamProfile = lazy(() => import("./routes/FantasyTeamProfile").then((m) => ({ default: m.FantasyTeamProfile })));
const Trades = lazy(() => import("./routes/Trades").then((m) => ({ default: m.Trades })));
const Help = lazy(() => import("./routes/Help").then((m) => ({ default: m.Help })));
const AdminHome = lazy(() => import("./routes/admin/AdminHome").then((m) => ({ default: m.AdminHome })));
const AdminPlayers = lazy(() => import("./routes/admin/AdminPlayers").then((m) => ({ default: m.AdminPlayers })));
const AdminRounds = lazy(() => import("./routes/admin/AdminRounds").then((m) => ({ default: m.AdminRounds })));
const AdminScorecards = lazy(() => import("./routes/admin/AdminScorecards").then((m) => ({ default: m.AdminScorecards })));
const AdminSettings = lazy(() => import("./routes/admin/AdminSettings").then((m) => ({ default: m.AdminSettings })));

/**
 * Route map. `/login` is the only unauthenticated page; everything else sits
 * behind <RequireAuth> inside the app shell (D17).
 *
 * /admin/* nests a second, pathless <RequireManager> layout route INSIDE
 * <RequireAuth>. Order matters: logged-out visitors are bounced to /login by the
 * outer guard before the manager check runs, so D17 holds for admin URLs too.
 * The manager check is chrome only — RLS (0004) is the authority (G13).
 *
 * Suspense is scoped to each page so the navigation and a profile's background
 * remain visible while its code downloads.
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
          <Route path="/" element={<DeferredPage><Ladder /></DeferredPage>} />
          <Route path="/players" element={<DeferredPage><Players /></DeferredPage>} />
          <Route path="/players/:id" element={<DeferredPage><PlayerProfile /></DeferredPage>} />
          <Route path="/rounds" element={<DeferredPage><Rounds /></DeferredPage>} />
          <Route path="/team" element={<DeferredPage><Team /></DeferredPage>} />
          <Route path="/teams/:id" element={<DeferredPage><FantasyTeamProfile /></DeferredPage>} />
          <Route path="/team/trades" element={<DeferredPage><Trades /></DeferredPage>} />
          <Route path="/help" element={<DeferredPage><Help /></DeferredPage>} />
          <Route element={<RequireManager />}>
            <Route path="/admin" element={<DeferredPage><AdminHome /></DeferredPage>} />
            <Route path="/admin/players" element={<DeferredPage><AdminPlayers /></DeferredPage>} />
            <Route path="/admin/rounds" element={<DeferredPage><AdminRounds /></DeferredPage>} />
            <Route path="/admin/scorecards" element={<DeferredPage><AdminScorecards /></DeferredPage>} />
            <Route path="/admin/settings" element={<DeferredPage><AdminSettings /></DeferredPage>} />
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
        <DeferredPage><PlayerProfile modal /></DeferredPage>
      </div>
    </div>
  );
}

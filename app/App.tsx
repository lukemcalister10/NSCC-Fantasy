import { Routes, Route, Navigate } from "react-router-dom";
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
  return (
    <Routes>
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
  );
}

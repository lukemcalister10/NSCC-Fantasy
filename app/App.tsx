import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./components/AppShell";
import { Login } from "./routes/Login";
import { Ladder } from "./routes/Ladder";
import { Players } from "./routes/Players";
import { PlayerProfile } from "./routes/PlayerProfile";
import { Rounds } from "./routes/Rounds";

/**
 * Route map. `/login` is the only unauthenticated page; everything else sits
 * behind <RequireAuth> inside the app shell (D17).
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

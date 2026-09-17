import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useIsManager } from "../lib/queries";
import logoUrl from "../assets/nscc-logo.avif";

/**
 * Participant entries — always visible to any signed-in user. `/team/trades` is
 * deliberately absent: it resolves by URL, but the team/trade slice (S-C) owns
 * where trades surface and may place them inside /team rather than beside it.
 */
const NAV = [
  { to: "/", label: "Ladder", end: true },
  { to: "/players", label: "Players", end: false },
  { to: "/rounds", label: "Rounds", end: false },
  { to: "/team", label: "My Team", end: false },
];

/** Manager-only entry. Hiding it is cosmetic; RLS (0004) is the boundary (G13). */
const ADMIN_NAV = { to: "/admin", label: "Admin", end: false };

/**
 * App chrome: a white top bar (hairline border) with the club logo on white and
 * the primary nav. Broadcast navy is reserved for the ladder header + scores, so
 * the shell itself stays clean-modern. Mobile-first: the nav is a horizontal
 * scroll-safe row that widens on larger screens.
 */
export function AppShell() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? "";
  const { data: isManager } = useIsManager();
  const items = isManager ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-row">
            <div className="brand">
              <img src={logoUrl} alt="NSCC" className="brand-logo" width={28} height={28} />
              <span className="brand-name">NSCC Fantasy</span>
            </div>
            <div className="topbar-account">
              {email ? <span className="account-email" title={email}>{email}</span> : null}
              <button className="btn-ghost" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
          <nav className="nav" aria-label="Primary">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `nav-link${isActive ? " nav-link-active" : ""}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

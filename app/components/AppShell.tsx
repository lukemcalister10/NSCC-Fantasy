import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import logoUrl from "../assets/nscc-logo.avif";

const NAV = [
  { to: "/", label: "Ladder", end: true },
  { to: "/players", label: "Players", end: false },
  { to: "/rounds", label: "Rounds", end: false },
];

/**
 * App chrome: a white top bar (hairline border) with the club logo on white and
 * the primary nav. Broadcast navy is reserved for the ladder header + scores, so
 * the shell itself stays clean-modern. Mobile-first: the nav is a horizontal
 * scroll-safe row that widens on larger screens.
 */
export function AppShell() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? "";

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
            {NAV.map((item) => (
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

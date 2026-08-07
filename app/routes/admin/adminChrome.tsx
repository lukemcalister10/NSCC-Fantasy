import type { ReactNode } from "react";
import "../../styles/admin.css";

/**
 * Shared furniture for the manager backend. Deliberately imports admin.css here
 * rather than from main.tsx: main.tsx is shared chrome that another concurrent
 * session also touches (Standing Rule 9c), and an admin stylesheet has no
 * business in the entry point of the league views.
 */

export function AdminPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      {intro ? <p className="page-sub">{intro}</p> : null}
      {children}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h2 className="admin-section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The season-lock state, said plainly. Post-lock, roles / WK eligibility /
 * starting prices are frozen by the database (D4/D9/G10) — the UI disables those
 * inputs, but the refusal that matters is the one behind them.
 */
export function SeasonLockBanner({ lockedAt }: { lockedAt: string | null }) {
  if (!lockedAt) {
    return (
      <div className="admin-banner">
        <strong>Season is not locked.</strong>
        <span>
          Roles, WK eligibility and starting prices are editable. Season lock is a
          one-way door: rehearse it on a scratch season first.
        </span>
      </div>
    );
  }
  return (
    <div className="admin-banner admin-banner-locked">
      <strong>Season locked.</strong>
      <span>
        Roles, WK eligibility and starting prices are frozen (D4/D9/G10) — the
        database refuses those edits, whichever way they are attempted. Names can
        still be corrected, and players can still be added mid-season.
      </span>
    </div>
  );
}

export function StatusLine({
  error,
  success,
}: {
  error?: unknown;
  success?: string | null;
}) {
  if (error) {
    return (
      <p className="admin-status admin-status-error" role="alert">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (success) {
    return (
      <p className="admin-status admin-status-ok" role="status">
        {success}
      </p>
    );
  }
  return null;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint ? <span style={{ fontWeight: 400, color: "var(--ink-faint)" }}> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

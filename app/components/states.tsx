import type { ReactNode } from "react";

/** Shared loading / error / empty blocks — one consistent treatment everywhere. */

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="state error" role="alert">
      <strong>Couldn’t load this data.</strong>
      <span style={{ fontSize: "var(--fs-sm)" }}>{message}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

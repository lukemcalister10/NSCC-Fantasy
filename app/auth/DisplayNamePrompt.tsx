import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { needsDisplayName, updateDisplayName, useMyProfileName } from "./displayName";

/**
 * ASK FOR A NAME ON FIRST SIGN-IN (item 5).
 *
 * Mounted inside `RequireAuth`, so it covers every authenticated view without the
 * router needing to know it exists — and so nobody can reach the league without
 * having been asked once.
 *
 * ── WHY IT IS INTERRUPTIVE, AND WHY IT IS NOT A TRAP ────────────────────────
 * Interruptive because the exposure is live: until the person answers, every
 * other participant reading the ladder sees their email address (0004 grants
 * `SELECT (display_name)` on every profile). A settings control they never
 * happen to visit does not fix that.
 *
 * Not a trap, in three specific ways — an identity gate that can strand someone
 * outside the app is worse than the exposure it closes:
 *   1. NO PROFILE ROW -> NEVER PROMPT. `fetchMyProfileName` returning `null`
 *      means absent, and an UPDATE has nothing to hit; prompting would block the
 *      user behind a form that cannot succeed. This is the C16 distinction doing
 *      real work: absent and "present but unnamed" need opposite handling, and a
 *      helper that folded them together would lock every un-provisioned user out
 *      of the whole app.
 *   2. STILL LOADING -> NEVER BLOCK. The app renders; the prompt appears when the
 *      answer arrives. This read is not a security boundary, so it does not get
 *      to hold the app up.
 *   3. "NOT NOW" ALWAYS WORKS. Dismissal is session-scoped, so it asks again next
 *      sign-in rather than nagging within one, and never bars the way.
 */
export function DisplayNamePrompt({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const profile = useMyProfileName(userId);
  const [dismissed, setDismissed] = useState(false);

  // Point 1 and 2 above: absent row, unanswered read, or an error on a read that
  // is not a security boundary — in every case the app renders.
  const row = profile.data ?? null;
  const shouldAsk =
    !!userId && !dismissed && !profile.isLoading && !profile.error && row !== null &&
    needsDisplayName(row.display_name);

  if (!shouldAsk) return <>{children}</>;

  return (
    <NamePromptCard
      userId={userId!}
      currentName={row!.display_name ?? ""}
      onDismiss={() => setDismissed(true)}
    />
  );
}

function NamePromptCard({
  userId,
  currentName,
  onDismiss,
}: {
  userId: string;
  currentName: string;
  onDismiss: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateDisplayName({ userId, displayName: name });
      // Every screen that shows a name reads it from one of these.
      await qc.invalidateQueries({ queryKey: ["my-profile-name"] });
      await qc.invalidateQueries({ queryKey: ["ladder"] });
      await qc.invalidateQueries({ queryKey: ["leaderboard"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const proposed = name.trim();
  const blocked = proposed.length === 0 || proposed.includes("@");

  return (
    <div className="page">
      <h1 className="page-title">What should everyone call you?</h1>
      <div className="card register-card">
        <h2 className="section-title">Choose your display name</h2>
        <p className="page-sub">
          Every player in this league can see this name — it appears on the ladder, the
          leaderboard and beside your team. Right now yours is{" "}
          <strong>{currentName}</strong>, which is the address you signed in with,
          because nothing has ever asked you. Pick a name instead.
        </p>
        {error ? (
          <div className="state error" role="alert">
            <strong>That didn’t save.</strong>
            <span style={{ fontSize: "var(--fs-sm)" }}>{error}</span>
          </div>
        ) : null}
        <div className="register-row">
          <input
            className="picker-search"
            value={name}
            maxLength={60}
            placeholder="Your name"
            aria-label="Display name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-primary" disabled={busy || blocked} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save name"}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={onDismiss}>
            Not now
          </button>
        </div>
        {proposed.includes("@") ? (
          <p className="table-foot-note">
            That still looks like an email address. Use a name — the whole point is that
            your address stops being visible to the rest of the league.
          </p>
        ) : null}
      </div>
    </div>
  );
}

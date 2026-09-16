import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  classifySignUp,
  signUpMessage,
  validateNewAccount,
  PASSWORD_MIN_LENGTH,
} from "../auth/signUpOutcome";
import logoUrl from "../assets/nscc-logo.avif";

type Mode = "create" | "password";
type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  /** Sign-up came back without a session — an account exists but cannot be used yet. */
  | { kind: "blocked"; message: string };

/**
 * The only unauthenticated page (D17). Two tabs: CREATE ACCOUNT and SIGN IN.
 *
 * ── THE MAGIC LINK TAB IS GONE (D35) ────────────────────────────────────────
 * It called `signInWithOtp`, which needs an email this project cannot send:
 * Supabase's built-in sender only delivers to project-team addresses, and a
 * custom sender needs a verified domain the operator does not have. In practice
 * the tab could only ever produce the "email rate limit exceeded" error the
 * operator hit on 15/09. Removing it is the point of the slice, not a tidy-up.
 * Password SIGN-IN is untouched — it is the operator's fallback for accounts he
 * creates by hand.
 *
 * ── WHICH TAB OPENS FIRST, AND WHY ──────────────────────────────────────────
 * CREATE ACCOUNT. Round 1 locks 19/09, so for the first few days essentially all
 * traffic is people who have never been here; a returning participant signs in
 * weekly and reads a two-tab strip without help. The asymmetry of getting it
 * wrong decides it: a returning person who types into Create account is told
 * "that email already has an account — switch to Sign in" and is one click from
 * where they meant to be, whereas a new person who lands on Sign in gets
 * "Invalid login credentials", which names no way forward. The graceful failure
 * is the one this default produces. One line to flip if traffic turns over.
 *
 * ── NO PASSWORD RESET EXISTS ────────────────────────────────────────────────
 * There is no email, so there is no self-service reset, and the Sign in tab says
 * so out loud. A missing "forgot password?" link with no explanation generates
 * precisely the support messages the operator has agreed to absorb — but only if
 * people know to send them to him.
 */
export function Login() {
  const { session, ready } = useAuth();
  const [mode, setMode] = useState<Mode>("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /**
   * FIRST RUN IS ONE JOURNEY, NOT THREE INTERRUPTIONS (item 4). A person who has
   * just created an account is sent to /team, not the ladder, so the sequence
   * reads create account -> "what should everyone call you?" (DisplayNamePrompt,
   * inside RequireAuth) -> register your team. No fourth screen was added: this
   * is only the ORDER, set by choosing where sign-up lands.
   */
  const [justSignedUp, setJustSignedUp] = useState(false);

  if (ready && session) return <Navigate to={justSignedUp ? "/team" : "/"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (mode === "create") {
      // 2d: the two mistakes worth catching without a round trip.
      const invalid = validateNewAccount({ email, password, confirmPassword });
      if (invalid) {
        setStatus({ kind: "error", message: invalid });
        return;
      }
    }

    setStatus({ kind: "working" });
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // session lands via onAuthStateChange → guard admits.
        return;
      }

      // `signUp` RETURNS auth errors rather than throwing them, so the response is
      // classified rather than trusted — see app/auth/signUpOutcome.ts.
      const outcome = classifySignUp(await supabase.auth.signUp({ email, password }));
      const message = signUpMessage(outcome);

      if (outcome.kind === "signed-in") {
        setJustSignedUp(true);
        return; // onAuthStateChange flips the session; the Navigate above takes over.
      }
      if (outcome.kind === "needs-confirmation") {
        setStatus({ kind: "blocked", message });
        return;
      }
      setStatus({ kind: "error", message });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }

  const working = status.kind === "working";
  const creating = mode === "create";

  function pick(next: Mode) {
    setMode(next);
    setStatus({ kind: "idle" });
    setConfirmPassword("");
  }

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="login-head">
          <img src={logoUrl} alt="NSCC" className="login-logo" width={52} height={52} />
          <h1 className="login-title">NSCC Fantasy</h1>
          <p className="login-sub">
            {creating
              ? "Create an account to pick your team."
              : "Sign in to view the league."}
          </p>
        </div>

        <div className="segmented" role="tablist" aria-label="Sign-in method">
          <button
            role="tab"
            aria-selected={creating}
            className={`seg${creating ? " seg-active" : ""}`}
            onClick={() => pick("create")}
          >
            Create account
          </button>
          <button
            role="tab"
            aria-selected={!creating}
            className={`seg${!creating ? " seg-active" : ""}`}
            onClick={() => pick("password")}
          >
            Sign in
          </button>
        </div>

        {status.kind === "blocked" ? (
          <p className="login-note" role="status">
            {status.message}
          </p>
        ) : (
          <form className="login-form" onSubmit={onSubmit}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={creating ? "new-password" : "current-password"}
                required
                // 2b: the stated requirement and the enforced one are the same
                // number, read from the project setting in one place.
                {...(creating ? { minLength: PASSWORD_MIN_LENGTH } : {})}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>

            {creating ? (
              <>
                <label className="field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </label>
                <p className="login-note">
                  At least {PASSWORD_MIN_LENGTH} characters. There is no password
                  reset email — if you forget it, Luke resets it for you, so pick
                  something you'll remember.
                </p>
              </>
            ) : (
              <p className="login-note">
                Forgotten your password? There's no reset email on this site — ask
                Luke and he'll set you a new one.
              </p>
            )}

            {status.kind === "error" ? (
              <p className="login-error" role="alert">
                {status.message}
              </p>
            ) : null}

            <button type="submit" className="btn-primary" disabled={working}>
              {working
                ? creating
                  ? "Creating account…"
                  : "Signing in…"
                : creating
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        )}
      </div>
      <p className="login-foot">Internal club data · authorised members only</p>
    </div>
  );
}

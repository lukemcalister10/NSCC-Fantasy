import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import logoUrl from "../assets/nscc-logo.avif";

type Mode = "password" | "magic";
type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string }
  | { kind: "sent" };

/**
 * The only unauthenticated page (D17). Both auth methods the kickoff names:
 * email + password (the seeded test users have one) and a magic link. On success
 * the AuthProvider's onAuthStateChange flips the session and the guard admits the
 * user; an already-authed visitor is bounced straight to the ladder.
 */
export function Login() {
  const { session, ready } = useAuth();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (ready && session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "working" });
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // session lands via onAuthStateChange → guard admits.
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setStatus({ kind: "sent" });
        return;
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }

  const working = status.kind === "working";

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="login-head">
          <img src={logoUrl} alt="NSCC" className="login-logo" width={52} height={52} />
          <h1 className="login-title">NSCC Fantasy</h1>
          <p className="login-sub">Sign in to view the league.</p>
        </div>

        <div className="segmented" role="tablist" aria-label="Sign-in method">
          <button
            role="tab"
            aria-selected={mode === "password"}
            className={`seg${mode === "password" ? " seg-active" : ""}`}
            onClick={() => {
              setMode("password");
              setStatus({ kind: "idle" });
            }}
          >
            Password
          </button>
          <button
            role="tab"
            aria-selected={mode === "magic"}
            className={`seg${mode === "magic" ? " seg-active" : ""}`}
            onClick={() => {
              setMode("magic");
              setStatus({ kind: "idle" });
            }}
          >
            Magic link
          </button>
        </div>

        {status.kind === "sent" ? (
          <p className="login-note" role="status">
            Check your inbox — we’ve emailed a sign-in link to <strong>{email}</strong>.
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

            {mode === "password" ? (
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
            ) : null}

            {status.kind === "error" ? (
              <p className="login-error" role="alert">
                {status.message}
              </p>
            ) : null}

            <button type="submit" className="btn-primary" disabled={working}>
              {working
                ? "Signing in…"
                : mode === "password"
                  ? "Sign in"
                  : "Email me a link"}
            </button>
          </form>
        )}
      </div>
      <p className="login-foot">Internal club data · authorised members only</p>
    </div>
  );
}

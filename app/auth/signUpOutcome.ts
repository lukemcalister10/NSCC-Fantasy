import type { AuthError, Session, User } from "@supabase/supabase-js";

/**
 * SELF-SERVICE SIGN-UP: THE DECISION LAYER (D35).
 *
 * Everything in this file is a PLAIN FUNCTION over what `supabase.auth.signUp`
 * hands back. No network, no React, no `supabase` import — so the branches that
 * actually decide what a person is told are testable in a harness that has
 * neither a browser nor a React renderer (the C16 lesson: test the seam, not a
 * re-implementation of it).
 *
 * ── WHAT THE INSTALLED LIBRARY ACTUALLY DOES ────────────────────────────────
 * Read out of @supabase/supabase-js 2.110.2 / @supabase/auth-js 2.110.2 rather
 * than assumed, because the already-registered response has changed across
 * versions and the two shapes need opposite handling:
 *
 *   1. `signUp` RETURNS auth errors, it does not throw them. GoTrueClient.signUp
 *      catches anything `isAuthError` and returns
 *      `{ data: { user: null, session: null }, error }`. Only a non-auth throw
 *      (a bug, a TypeError) escapes. So the caller reads `error`, and a
 *      `try/catch` alone would silently treat every failure as a success.
 *
 *   2. ALREADY REGISTERED, "Confirm email" OFF -> an ERROR comes back:
 *      `AuthApiError` with `code` of `user_already_exists` (older GoTrue builds
 *      and some paths send `email_exists`). `handleError` in lib/fetch.js lifts
 *      that code from the response body — `data.code` under the 2024-01-01 API
 *      version the client always sends, else `data.error_code` — onto
 *      `error.code`. The code is the discriminator; the human message is not.
 *
 *   3. ALREADY REGISTERED, "Confirm email" ON -> NO ERROR AT ALL. GoTrue
 *      deliberately returns a fabricated user so an attacker cannot enumerate
 *      addresses, and `_sessionResponse` passes it through as
 *      `{ session: null, user }`. The tell is `identities: []` — an empty
 *      identity list, which a genuinely new account never has. `User.identities`
 *      is `UserIdentity[] | undefined` in the installed types.
 *
 * Shapes 3 and 4 below BOTH arrive as `session === null` with a user object, so
 * the empty-identities check is the only thing separating "you already have an
 * account" from "your account was made but we cannot email you". Collapsing them
 * would tell half the people the exact opposite of the truth.
 */

/**
 * The project-level minimum password length (Supabase → Authentication →
 * Sign In / Providers → Minimum password length, default 6).
 *
 * ONE NUMBER, TWO USES: the hint shown before submission and the `minLength` on
 * the input are both read from here, so the form cannot state one rule and
 * enforce another. It deliberately adds NO extra client-side rule (no symbol, no
 * case mix) — an invented rule the server does not share is exactly the
 * disagreement this constant exists to prevent. THE SERVER REMAINS AUTHORITATIVE:
 * if the project minimum is raised beyond this, the `weak_password` rejection is
 * still mapped and shown (see `SignUpOutcome`), and this constant is the single
 * line to update to match.
 */
export const PASSWORD_MIN_LENGTH = 6;

/** What the sign-up attempt actually was, once the two ambiguous shapes are split. */
export type SignUpOutcome =
  /** A session came back — the person is signed in; the guard admits them. */
  | { kind: "signed-in" }
  /** The address already has an account (either response shape). */
  | { kind: "already-registered" }
  /** Created, but no session: "Confirm email" is ON and this site cannot send one. */
  | { kind: "needs-confirmation" }
  /** The server refused the password. `detail` is the server's own wording. */
  | { kind: "password-rejected"; detail: string }
  | { kind: "signup-disabled" }
  | { kind: "invalid-email" }
  | { kind: "rate-limited" }
  | { kind: "offline" }
  | { kind: "unknown"; detail: string };

/** The part of `signUp`'s resolved value this module reads. */
export interface SignUpResponse {
  data: { user: User | null; session: Session | null };
  error: AuthError | null;
}

/** Codes GoTrue uses for "that address is taken", per the installed error-code union. */
const ALREADY_REGISTERED_CODES = new Set(["user_already_exists", "email_exists"]);

/**
 * Did GoTrue hand back a fabricated user to avoid confirming that an address
 * exists? An account it has just created always carries the identity row it was
 * created with; the anti-enumeration stand-in carries an empty list.
 *
 * `undefined` is NOT treated as empty — a response that omits the field entirely
 * is not evidence of anything, and guessing "already registered" there would
 * turn a real new account into a dead end.
 */
function isObfuscatedExistingUser(user: User | null): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}

/**
 * Classify a `signUp` response. Total: every input lands on exactly one outcome.
 *
 * ORDER IS LOAD-BEARING. The error is read first (an error means no account was
 * made), then the session (a session means it worked), and only then are the two
 * no-session shapes split on identities.
 */
export function classifySignUp(res: SignUpResponse): SignUpOutcome {
  const { error } = res;

  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    if (ALREADY_REGISTERED_CODES.has(code)) return { kind: "already-registered" };
    if (code === "weak_password") return { kind: "password-rejected", detail: error.message };
    if (code === "signup_disabled") return { kind: "signup-disabled" };
    if (code === "email_address_invalid" || code === "validation_failed") {
      return { kind: "invalid-email" };
    }
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
      return { kind: "rate-limited" };
    }
    // A failed fetch never reaches the API, so it carries no code and status 0.
    if (error.name === "AuthRetryableFetchError") return { kind: "offline" };
    // Legacy weak-password responses predate error codes and arrive as a typed
    // error instead (AuthWeakPasswordError, thrown by handleError).
    if (error.name === "AuthWeakPasswordError") {
      return { kind: "password-rejected", detail: error.message };
    }
    // Some deployments report a taken address as a 422 with no usable code.
    if (/already registered|already exists/i.test(error.message)) {
      return { kind: "already-registered" };
    }
    return { kind: "unknown", detail: error.message };
  }

  if (res.data.session) return { kind: "signed-in" };

  // No error and no session: either the anti-enumeration stand-in (shape 3) or a
  // real account awaiting a confirmation email this project cannot send (shape 4).
  if (isObfuscatedExistingUser(res.data.user)) return { kind: "already-registered" };
  if (res.data.user) return { kind: "needs-confirmation" };

  return {
    kind: "unknown",
    detail: "Sign-up returned neither an account nor an error.",
  };
}

/**
 * Terminate an embedded server string so the sentence that follows it reads as a
 * sentence. GoTrue is inconsistent about trailing punctuation ("Password should
 * be at least 6 characters." vs "Password is too short"), and the difference is
 * the gap between a readable message and two clauses run together.
 */
function asClause(detail: string): string {
  const trimmed = detail.trim();
  if (trimmed.length === 0) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The sentence a club cricketer reads. Each one names what happened AND what to
 * do next; none of them is a raw server string, and none is a dead end — including
 * the unrecognised case, which still points at the one person who can help.
 */
export function signUpMessage(outcome: SignUpOutcome): string {
  switch (outcome.kind) {
    case "signed-in":
      return "You're in.";
    case "already-registered":
      return "That email already has an account. Switch to the Sign in tab and use your password — if you've forgotten it, ask Luke to reset it for you.";
    case "needs-confirmation":
      return "Your account was created, but this site cannot send confirmation emails, so it isn't active yet. Ask Luke to confirm it and then sign in.";
    case "password-rejected":
      return `That password was rejected: ${asClause(outcome.detail)} Please choose another one.`;
    case "signup-disabled":
      return "New accounts are switched off at the moment. Ask Luke to create one for you.";
    case "invalid-email":
      return "That doesn't look like a valid email address. Check it and try again.";
    case "rate-limited":
      return "Too many attempts from here just now. Wait a minute and try again.";
    case "offline":
      return "Couldn't reach the server. Check your connection and try again.";
    case "unknown":
      return `Sign-up failed: ${asClause(outcome.detail)} Try again, and if it keeps happening ask Luke to create your account.`;
  }
}

/**
 * The checks that happen BEFORE the call — the two mistakes worth catching
 * without a round trip. Returns the message to show, or `null` to proceed.
 *
 * The length check mirrors the project setting via `PASSWORD_MIN_LENGTH` and
 * stops there; anything stricter is the server's call, not this form's.
 */
export function validateNewAccount(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (input.email.trim().length === 0) return "Enter your email address.";
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    return `Your password needs to be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (input.password !== input.confirmPassword) {
    return "The two passwords don't match. Retype them.";
  }
  return null;
}

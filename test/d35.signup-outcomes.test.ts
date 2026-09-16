import { describe, expect, it } from "vitest";
import { AuthApiError, AuthError, AuthWeakPasswordError } from "@supabase/auth-js";
import type { Session, User } from "@supabase/supabase-js";
import {
  PASSWORD_MIN_LENGTH,
  classifySignUp,
  signUpMessage,
  validateNewAccount,
  type SignUpResponse,
} from "../app/auth/signUpOutcome.js";

/**
 * D35 — SELF-SERVICE SIGN-UP: THE BRANCHES THAT DECIDE WHAT A PERSON IS TOLD.
 *
 * WHY THESE AND NOT A RENDER TEST. The harness has vitest and pglite — no
 * browser, no jsdom, no React testing library — so "click Create account and see
 * the form" is not testable here and is an operator acceptance step (written out
 * in the session report). What IS testable, and is where the whole risk of this
 * slice sits, is the classification: sign-up has FOUR distinct outcomes, two of
 * which arrive as `session === null` with a user object and mean opposite things.
 * Getting that split wrong tells half the people the exact reverse of the truth.
 *
 * THE ERROR SHAPES BELOW ARE NOT INVENTED. They are constructed with the
 * installed library's own error classes (@supabase/auth-js 2.110.2) and the
 * codes from its own `error-codes.d.ts` union, because the already-registered
 * response depends on the "Confirm email" setting and has changed across
 * versions — the same discipline S-G applied to postgrest-js `maybeSingle`
 * cardinality. `handleError` (lib/fetch.js) lifts `data.code` onto
 * `AuthApiError.code`, which is what these fixtures reproduce.
 *
 * CONTROL RUN: every test here was run against a deliberately broken
 * `classifySignUp` and FAILED — see the session report for the two mutations and
 * their output. A test that passes on the unbuilt code proves nothing; that is
 * the lesson C16 exists to record.
 */

/** A user object shaped like the installed `User` interface. */
function user(over: Partial<User> = {}): User {
  return {
    id: "00000000-0000-0000-0000-00000d350001",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-16T00:00:00Z",
    email: "newcomer@example.com",
    identities: [
      {
        id: "00000000-0000-0000-0000-00000d35ide1",
        user_id: "00000000-0000-0000-0000-00000d350001",
        identity_id: "00000000-0000-0000-0000-00000d35ide2",
        provider: "email",
        identity_data: { email: "newcomer@example.com" },
        created_at: "2026-09-16T00:00:00Z",
        last_sign_in_at: "2026-09-16T00:00:00Z",
      },
    ],
    ...over,
  } as User;
}

const session = { access_token: "a", user: user() } as unknown as Session;

const ok = (over: Partial<SignUpResponse["data"]>): SignUpResponse => ({
  data: { user: null, session: null, ...over },
  error: null,
});
const failed = (error: AuthError): SignUpResponse => ({
  data: { user: null, session: null },
  error,
});

describe("D35 classifySignUp — the four outcomes of a sign-up attempt", () => {
  it("a session came back -> signed-in (the happy path)", () => {
    expect(classifySignUp(ok({ user: user(), session }))).toEqual({ kind: "signed-in" });
  });

  /**
   * 2a, SHAPE 1 — "Confirm email" OFF, which is the operator's configuration.
   * GoTrue refuses outright and the code is the discriminator.
   */
  it("already registered, confirmations OFF -> classified on the CODE alone", () => {
    for (const code of ["user_already_exists", "email_exists"]) {
      // The message here is deliberately neutral — it contains none of the words
      // the last-resort message match looks for. So the error CODE is the only
      // thing that can classify this, which is what pins the documented shape.
      // (A control run that mutated away the code branch while the message still
      // read "User already registered" passed on the broken code: the fallback
      // was quietly doing the work the test claimed to be checking.)
      const res = failed(new AuthApiError("Email address is taken", 422, code));
      expect(classifySignUp(res)).toEqual({ kind: "already-registered" });
    }
  });

  it("a taken address with no usable code still falls back to the message", () => {
    // Some deployments report it as a bare 422. The fallback is a safety net for
    // that case only — the test above proves it is not load-bearing.
    const res = failed(new AuthApiError("User already registered", 422, undefined));
    expect(classifySignUp(res)).toEqual({ kind: "already-registered" });
  });

  /**
   * 2a, SHAPE 2 — "Confirm email" ON. NO ERROR AT ALL: GoTrue returns a
   * fabricated user with an EMPTY identity list so addresses cannot be
   * enumerated. This is the shape a version assumption would get wrong.
   */
  it("already registered, confirmations ON -> obfuscated user, identities: []", () => {
    const res = ok({ user: user({ identities: [] }) });
    expect(classifySignUp(res)).toEqual({ kind: "already-registered" });
  });

  /**
   * 2c — THE DEFENSIVE CASE. Same `session === null` as the shape above, and the
   * ONLY thing separating them is that this user carries the identity it was
   * created with. If a config change turns "Confirm email" back on, this is the
   * branch that stops sign-up failing silently.
   */
  it("created but no session -> needs-confirmation, NOT already-registered", () => {
    const res = ok({ user: user() });
    expect(classifySignUp(res)).toEqual({ kind: "needs-confirmation" });
    expect(signUpMessage(classifySignUp(res))).toMatch(/cannot send confirmation emails/i);
  });

  it("the two no-session shapes are told apart by identities alone", () => {
    // Identical but for the identity list, and they mean opposite things.
    expect(classifySignUp(ok({ user: user({ identities: [] }) })).kind).toBe(
      "already-registered",
    );
    expect(classifySignUp(ok({ user: user() })).kind).toBe("needs-confirmation");
    // An ABSENT list is not evidence of anything, so it must not read as "taken"
    // — guessing there would turn a real new account into a dead end. The key is
    // omitted outright rather than set to undefined, which is the difference
    // `exactOptionalPropertyTypes` insists on and the shape a real response has.
    const { identities: _omitted, ...withoutIdentities } = user();
    expect(classifySignUp(ok({ user: withoutIdentities as User })).kind).toBe(
      "needs-confirmation",
    );
  });

  /** 2b — the server's own rejection, mapped rather than shown raw. */
  it("weak_password -> password-rejected, carrying the server's wording", () => {
    const coded = failed(
      new AuthApiError("Password should be at least 6 characters.", 422, "weak_password"),
    );
    expect(classifySignUp(coded)).toEqual({
      kind: "password-rejected",
      detail: "Password should be at least 6 characters.",
    });
    // Legacy deployments send it as a typed error with no usable code.
    const typed = failed(
      new AuthWeakPasswordError("Password is too short", 422, ["length"]),
    );
    expect(classifySignUp(typed).kind).toBe("password-rejected");
  });

  it("the other named failures each get their own outcome", () => {
    const cases: ReadonlyArray<readonly [AuthError, string]> = [
      [new AuthApiError("Signups not allowed", 422, "signup_disabled"), "signup-disabled"],
      [new AuthApiError("Invalid email", 400, "email_address_invalid"), "invalid-email"],
      [new AuthApiError("rate limit", 429, "over_email_send_rate_limit"), "rate-limited"],
    ];
    for (const [error, kind] of cases) {
      expect(classifySignUp(failed(error)).kind).toBe(kind);
    }
  });

  it("an unrecognised failure still produces a sentence, never a blank screen", () => {
    const res = classifySignUp(failed(new AuthApiError("boom", 500, "something_new")));
    expect(res.kind).toBe("unknown");
    expect(signUpMessage(res)).toContain("boom");
  });

  it("neither account nor error -> unknown, not a silent success", () => {
    expect(classifySignUp(ok({})).kind).toBe("unknown");
  });
});

describe("D35 signUpMessage — every outcome names a way forward", () => {
  it("already-registered sends them to the Sign in tab, not into a failure", () => {
    const msg = signUpMessage({ kind: "already-registered" });
    expect(msg).toMatch(/sign in/i);
    // It must not read as an error the person caused and cannot fix.
    expect(msg).not.toMatch(/invalid|denied|failed/i);
  });

  it("no outcome leaves a person without an instruction, and none is raw", () => {
    const outcomes = [
      { kind: "already-registered" },
      { kind: "needs-confirmation" },
      { kind: "password-rejected", detail: "too short" },
      { kind: "signup-disabled" },
      { kind: "invalid-email" },
      { kind: "rate-limited" },
      { kind: "offline" },
      { kind: "unknown", detail: "x" },
    ] as const;
    for (const o of outcomes) {
      const msg = signUpMessage(o);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).toMatch(/[.!]$/); // a sentence, not an error string
    }
    // The two that need a human name the human (there is no self-service reset).
    expect(signUpMessage({ kind: "already-registered" })).toMatch(/Luke/);
    expect(signUpMessage({ kind: "needs-confirmation" })).toMatch(/Luke/);
  });
});

describe("D35 validateNewAccount — the checks made before any call", () => {
  const good = { email: "a@b.com", password: "sixchr", confirmPassword: "sixchr" };

  it("accepts a valid pair", () => {
    expect(validateNewAccount(good)).toBeNull();
  });

  /** 2d — client-side, before the call. */
  it("mismatched passwords are refused, and say so plainly", () => {
    const msg = validateNewAccount({ ...good, confirmPassword: "sixchs" });
    expect(msg).toMatch(/don't match/i);
  });

  /** 2b — the stated rule and the enforced rule are the same number. */
  it("a password shorter than the project minimum is refused before the round trip", () => {
    const short = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    const msg = validateNewAccount({ ...good, password: short, confirmPassword: short });
    expect(msg).toContain(String(PASSWORD_MIN_LENGTH));
    // Exactly the minimum passes — the form must not be stricter than the server.
    const exact = "x".repeat(PASSWORD_MIN_LENGTH);
    expect(validateNewAccount({ ...good, password: exact, confirmPassword: exact })).toBeNull();
  });

  it("adds no invented rule the server does not share", () => {
    // All-lowercase, no digit, no symbol: the server accepts it, so this must too.
    const plain = "abcdef";
    expect(
      validateNewAccount({ ...good, password: plain, confirmPassword: plain }),
    ).toBeNull();
  });

  it("a blank email is caught before the call", () => {
    expect(validateNewAccount({ ...good, email: "   " })).toMatch(/email/i);
  });

  it("length is checked before the match, so the more specific fault is named", () => {
    const msg = validateNewAccount({ ...good, password: "abc", confirmPassword: "zzz" });
    expect(msg).toContain(String(PASSWORD_MIN_LENGTH));
  });
});

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * DISPLAY NAMES (item 5 — a Law 11 / D17 exposure, not a cosmetic nicety).
 *
 * Sign-up provisioning fills `profiles.display_name` from the account, so every
 * display name in the league is currently a person's EMAIL ADDRESS. 0004 grants
 * every authenticated user `SELECT (id, display_name, photo_path,
 * is_league_manager)` on EVERY profile — deliberately, because you play H2H
 * against these people and have to see who they are. The consequence as it
 * stands is that joining the league hands your email address to everyone else in
 * it, in a pool that includes juniors.
 *
 * The fix is to ASK, which nothing has ever done. This module is the read, the
 * write and the decision of when to ask; `DisplayNamePrompt` is the asking.
 *
 * NO MIGRATION IS INVOLVED. 0004 already grants exactly this and nothing more:
 * `GRANT UPDATE (display_name, photo_path) ON profiles TO authenticated` plus
 * `profiles_self_update` (`id = auth.uid()`). So a participant may set their own
 * display name and nothing else — `is_league_manager` is in no authenticated
 * grant and is therefore not self-settable here even by a manager (0004
 * Decision 4). Supabase-side sign-up provisioning lives outside
 * supabase/migrations/ and is NOT touched.
 */

export interface ProfileName {
  id: string;
  display_name: string | null;
}

/**
 * Is this profile still showing an auto-provisioned identifier rather than a
 * name the person chose?
 *
 * A plain total function so the prompt's trigger is pinned by a test rather than
 * discovered in production. TRUE when the name is missing or blank (never asked),
 * or when it still looks like an email address — which is what provisioning
 * leaves behind and is the actual privacy exposure. An `@` is the test: it cannot
 * appear in a name someone typed for themselves, and it is present in every
 * address. Deliberately NOT a full email regex — a malformed address is exactly
 * as exposing as a well-formed one.
 */
export function needsDisplayName(displayName: string | null | undefined): boolean {
  if (typeof displayName !== "string") return true;
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return true;
  return trimmed.includes("@");
}

/**
 * The signed-in user's own profile name, or `null` when no profile row has been
 * provisioned yet.
 *
 * ABSENT IS `null`, NOT AN EMPTY COLLECTION — the C16 rule. This read is a
 * `.maybeSingle()`, the exact shape that broke `fetchMyTeam`, so it returns the
 * row or null directly and never routes through a list-shaped unwrapper.
 */
export async function fetchMyProfileName(userId: string): Promise<ProfileName | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ProfileName | null;
}

/**
 * Set the signed-in user's own display name.
 *
 * `.select()` is load-bearing for the same reason as `renameTeam`: under RLS an
 * UPDATE the policy excludes is a silent no-op, so asking for the row back is
 * what turns "not permitted" into a visible failure instead of a false success.
 */
export async function updateDisplayName(args: {
  userId: string;
  displayName: string;
}): Promise<ProfileName> {
  const trimmed = args.displayName.trim();
  if (trimmed.length === 0) throw new Error("A display name cannot be blank.");
  if (trimmed.includes("@")) {
    throw new Error(
      "Please use a name rather than an email address — every player in the league can see this.",
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", args.userId)
    .select("id,display_name")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "The change affected no rows — the database did not permit it for your account (row-level security).",
    );
  }
  return data as ProfileName;
}

const STALE = 30_000;

export function useMyProfileName(userId: string | undefined) {
  return useQuery({
    queryKey: ["my-profile-name", userId],
    enabled: !!userId,
    staleTime: STALE,
    queryFn: (): Promise<ProfileName | null> => fetchMyProfileName(userId!),
  });
}

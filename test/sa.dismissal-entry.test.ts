import { describe, it, expect } from "vitest";
import {
  parseTypedDismissal,
  buildResolvedText,
  describeResolved,
} from "../app/lib/dismissalEntry.js";
import { parseDismissal } from "../src/engines/dismissal.js";
import { defaultRoundLockAt, adelaideLocalToInstant } from "../app/lib/lockTime.js";

/**
 * DISMISSAL ENTRY (D25) and the ROUND-LOCK DEFAULT (D6) — the two places where
 * the admin forms turn operator input into stored truth.
 *
 * The dismissal tests are written as a ROUND TRIP: what the operator types is
 * resolved to ids, and the SAME engine parser that will score the stored string
 * is then asked what it credits. If entry and scoring ever disagree, this fails.
 *
 * Names invented (D17/Law 11), except the O'Callaghan apostrophe case, which is
 * the recorded D22 failure and the reason any of this exists.
 */

const SAM = "71a70000-0000-4000-8000-000000d25001";
const TOM = "71a70000-0000-4000-8000-000000d25002";
const ADAM = "71a70000-0000-4000-8000-000000d25003";
const PRIYA = "71a70000-0000-4000-8000-000000d25004";

const LINEUP = [
  { id: SAM, displayName: "Sam Hollis" },
  { id: TOM, displayName: "Tomas Reiner" },
  { id: ADAM, displayName: "Adam O'Callaghan" },
  { id: PRIYA, displayName: "Priya Raman" },
];

describe("D25 — dismissal fielders resolve to canonical player ids at entry", () => {
  it("credits a catch to the named fielder, and the engine agrees", () => {
    const parsed = parseTypedDismissal("c Sam Hollis b Tomas Reiner", LINEUP);
    expect(parsed.kind).toBe("caught");
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.fielderIds).toEqual([SAM]);

    const credits = parseDismissal(parsed.resolvedText);
    expect(credits).toEqual([{ fielder: SAM, kind: "catch", assisted: false }]);
  });

  it("resolves across the curly/straight apostrophe (D22, the recorded failure)", () => {
    const parsed = parseTypedDismissal("c Adam O’Callaghan b Priya Raman", LINEUP);
    expect(parsed.unresolved).toEqual([]);
    expect(parseDismissal(parsed.resolvedText)[0]!.fielder).toBe(ADAM);
  });

  it("handles stumpings, caught-and-bowled, and both run-out shapes", () => {
    const st = parseTypedDismissal("st Sam Hollis b Tomas Reiner", LINEUP);
    expect(parseDismissal(st.resolvedText)).toEqual([
      { fielder: SAM, kind: "stumping", assisted: false },
    ]);

    const candb = parseTypedDismissal("c & b Tomas Reiner", LINEUP);
    expect(parseDismissal(candb.resolvedText)).toEqual([
      { fielder: TOM, kind: "catch", assisted: false },
    ]);

    const solo = parseTypedDismissal("run out (Priya Raman)", LINEUP);
    expect(parseDismissal(solo.resolvedText)).toEqual([
      { fielder: PRIYA, kind: "runout", assisted: false },
    ]);

    const shared = parseTypedDismissal("run out (Priya Raman/Sam Hollis)", LINEUP);
    expect(shared.kind).toBe("run_out_assisted");
    expect(parseDismissal(shared.resolvedText)).toEqual([
      { fielder: PRIYA, kind: "runout", assisted: true },
      { fielder: SAM, kind: "runout", assisted: true },
    ]);
  });

  it("awards nothing for bowled / LBW / an unnamed catcher (D25, accepted)", () => {
    for (const text of ["b Tomas Reiner", "lbw b Tomas Reiner", "c sub b Tomas Reiner", ""]) {
      const parsed = parseTypedDismissal(text, LINEUP);
      if (text === "c sub b Tomas Reiner") {
        // A name outside the lineup is UNRESOLVED, not silently dropped.
        expect(parsed.unresolved).toEqual(["sub"]);
        continue;
      }
      expect(parsed.fielderIds).toEqual([]);
      expect(parseDismissal(parsed.resolvedText)).toEqual([]);
    }
  });

  it("BLOCKS on an unresolved name instead of guessing (G12 discipline)", () => {
    const parsed = parseTypedDismissal("c S Hollis b Tomas Reiner", LINEUP);
    expect(parsed.unresolved).toEqual(["S Hollis"]);
    expect(parsed.resolvedText).toBe(""); // nothing to save until it is fixed
  });

  it("only credits players in THIS match's lineup", () => {
    // Correctly spelled, in the registry — but he did not play this match.
    const parsed = parseTypedDismissal("c Renée Dufort b Tomas Reiner", LINEUP);
    expect(parsed.unresolved).toEqual(["Renée Dufort"]);
  });

  it("renders a stored canonical string back as names for review", () => {
    expect(describeResolved(buildResolvedText("caught", [SAM]), LINEUP)).toBe(
      "caught by Sam Hollis",
    );
    expect(describeResolved(buildResolvedText("run_out_assisted", [SAM, TOM]), LINEUP)).toBe(
      "run out by Sam Hollis and Tomas Reiner (assisted)",
    );
    expect(describeResolved("b -", LINEUP)).toBe("no fielding credit");
  });
});

describe("D6 — the round-lock default is Adelaide's clock, not a hardcoded offset", () => {
  it("proposes 11:00 Adelaide on the next Saturday", () => {
    // A Wednesday in October (ACDT, +10:30) -> Saturday 11:00 local = 00:30 UTC.
    const from = new Date("2026-10-07T02:00:00Z");
    expect(defaultRoundLockAt(from)).toBe("2026-10-10T00:30:00.000Z");
  });

  it("tracks daylight saving instead of assuming a fixed offset", () => {
    // Winter (ACST, +9:30): 11:00 local = 01:30 UTC.
    const winter = new Date("2026-07-01T02:00:00Z");
    expect(defaultRoundLockAt(winter)).toBe("2026-07-04T01:30:00.000Z");
    // Summer (ACDT, +10:30): 11:00 local = 00:30 UTC. Same wall clock, one hour
    // apart in UTC — which is exactly why the offset is never written down.
    expect(adelaideLocalToInstant(2027, 1, 9, 11, 0).toISOString()).toBe(
      "2027-01-09T00:30:00.000Z",
    );
    expect(adelaideLocalToInstant(2026, 7, 4, 11, 0).toISOString()).toBe(
      "2026-07-04T01:30:00.000Z",
    );
  });

  it("never proposes 'today' even when today is a Saturday", () => {
    const saturday = new Date("2026-10-10T04:00:00Z"); // Sat afternoon in Adelaide
    expect(defaultRoundLockAt(saturday)).toBe("2026-10-17T00:30:00.000Z");
  });
});

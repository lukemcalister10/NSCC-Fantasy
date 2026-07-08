/**
 * Parse opposition dismissal strings into club fielding credits (KICKOFF DATA
 * ENTRY: "Fielding extracted from opposition dismissal strings").
 *
 * Recognised forms (case-insensitive, whitespace-tolerant):
 *   "c Fielder b Bowler"        -> catch to Fielder
 *   "c & b Bowler" / "c and b"  -> caught-and-bowled: catch to Bowler
 *   "st Keeper b Bowler"        -> stumping to Keeper
 *   "run out (Fielder)"         -> unassisted run-out to Fielder
 *   "run out (A/B)" / "(A, B)"  -> assisted run-out, credited to A and B
 *   "b Bowler", "lbw ...",
 *   "not out", "dnb", "absent"  -> no fielding credit
 *
 * Bowler wickets are intentionally NOT emitted here — they come from the
 * bowling figures — so a caught dismissal yields only the fielder's catch.
 */

export type FieldingKind = "catch" | "stumping" | "runout";

export interface FieldingCredit {
  fielder: string;
  kind: FieldingKind;
  /** For run-outs: true when multiple fielders shared it (assisted, D-O4). */
  assisted: boolean;
}

const clean = (s: string): string => s.trim().replace(/\s+/g, " ");

export function parseDismissal(raw: string): FieldingCredit[] {
  const s = clean(raw);
  if (s === "") return [];
  const lower = s.toLowerCase();

  // No fielding credit for these terminal states.
  if (
    lower === "not out" ||
    lower === "dnb" ||
    lower === "did not bat" ||
    lower.startsWith("absent") ||
    lower.startsWith("retired") ||
    lower === "b" ||
    /^b\s+/.test(lower) || // bowled
    /^lbw\b/.test(lower) || // lbw
    lower.startsWith("hit wicket")
  ) {
    return [];
  }

  // Run out: "run out (A)" or "run out (A/B)" or "run out (A, B)".
  const runOut = /^run\s*out\s*\(([^)]*)\)/i.exec(s);
  if (runOut) {
    const inner = runOut[1] ?? "";
    const fielders = inner
      .split(/[/,]/)
      .map(clean)
      .filter((f) => f !== "" && f.toLowerCase() !== "unknown");
    if (fielders.length === 0) return [];
    const assisted = fielders.length > 1;
    return fielders.map((fielder) => ({ fielder, kind: "runout", assisted }));
  }

  // Stumping: "st Keeper b Bowler".
  const stumping = /^st\s+(.+?)\s+b\s+/i.exec(s);
  if (stumping) {
    return [{ fielder: clean(stumping[1] ?? ""), kind: "stumping", assisted: false }];
  }

  // Caught-and-bowled: "c & b Bowler" / "c and b Bowler".
  const candB = /^c\s*(?:&|and)\s*b\s+(.+)$/i.exec(s);
  if (candB) {
    return [{ fielder: clean(candB[1] ?? ""), kind: "catch", assisted: false }];
  }

  // Caught: "c Fielder b Bowler".
  const caught = /^c\s+(.+?)\s+b\s+/i.exec(s);
  if (caught) {
    return [{ fielder: clean(caught[1] ?? ""), kind: "catch", assisted: false }];
  }

  return [];
}

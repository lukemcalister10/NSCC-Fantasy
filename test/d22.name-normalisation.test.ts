import { describe, it, expect, beforeAll } from "vitest";
import {
  normaliseName,
  nameMatchKey,
  namesMatch,
  resolveName,
} from "../src/registry/nameNormalisation.js";
import { makeTestDb } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * D22 PLAYER NAME NORMALISATION (DECISION_LOG A9, 07/08/2026).
 *
 * Two implementations exist by necessity — `app.normalise_name()` in the database
 * (the gatekeeper, D16: it normalises whatever client writes) and
 * `normaliseName()` in TypeScript (so the admin UI can match, preview and warn
 * before it writes). Two implementations of one rule drift unless something holds
 * them together, so ONE case table below is run through BOTH.
 *
 * NAMES ARE INVENTED except "Adam O'Callaghan", which is the real recorded
 * failure (D22): a spreadsheet round-trip rewrote U+2019 to U+0027, which against
 * a registry storing the other form is the G12 unresolved-name failure mode,
 * recurring every week, invisibly.
 */

// [input, expected normalised output, what it exercises]
const CASES: [string, string, string][] = [
  ["Adam O’Callaghan", "Adam O'Callaghan", "U+2019 curly apostrophe -> U+0027 (the real failure)"],
  ["Adam O'Callaghan", "Adam O'Callaghan", "already-ASCII apostrophe is untouched"],
  ["Adam O‘Callaghan", "Adam O'Callaghan", "U+2018 left single quote -> U+0027"],
  ["Ravi “Spin” Nayar", 'Ravi "Spin" Nayar', "U+201C/U+201D curly doubles -> U+0022"],
  ["Tomas Reiner", "Tomas Reiner", "U+00A0 non-breaking space -> space"],
  ["Jo   Whitlam", "Jo Whitlam", "internal whitespace run collapses to one space"],
  ["  Priya Raman  ", "Priya Raman", "leading/trailing whitespace trimmed"],
  ["Sam\tHollis\nPark", "Sam Hollis Park", "tabs and newlines are whitespace too"],
  ["Renée Dufort", "Renée Dufort", "DIACRITICS PRESERVED — never folded to ASCII"],
  ["McDONALD-Price", "McDONALD-Price", "CASE PRESERVED, hyphens untouched"],
  ["ﬁnn Beaumont", "finn Beaumont", "NFKC decomposes the ﬁ ligature"],
  ["Ⅳan Petrov", "IVan Petrov", "NFKC folds the Roman-numeral codepoint"],
  ["", "", "empty in, empty out — total function"],
  ["   ", "", "whitespace-only normalises to empty"],
];

describe("D22 — name normalisation (TypeScript half)", () => {
  for (const [input, expected, what] of CASES) {
    it(what, () => {
      expect(normaliseName(input)).toBe(expected);
    });
  }

  it("matches the recorded O'Callaghan failure across the two apostrophes", () => {
    expect(namesMatch("Adam O’Callaghan", "Adam O'Callaghan")).toBe(true);
  });

  it("folds case for MATCHING while storage keeps the operator's case", () => {
    expect(namesMatch("adam o'callaghan", "Adam O'Callaghan")).toBe(true);
    expect(normaliseName("adam o'callaghan")).toBe("adam o'callaghan");
  });

  it("does NOT fold diacritics — two different players stay different", () => {
    expect(namesMatch("Renée Dufort", "Renee Dufort")).toBe(false);
    expect(nameMatchKey("Renée Dufort")).toBe("renée dufort");
  });

  it("resolves an inbound name to exactly one registry entry, or refuses", () => {
    const registry = [
      { displayName: "Adam O'Callaghan" },
      { displayName: "Priya Raman" },
    ];
    expect(resolveName("Adam O’Callaghan", registry)).toBe(registry[0]);
    expect(resolveName("A. O'Callaghan", registry)).toBeNull(); // unmatched -> ask
    // Ambiguity is a refusal, never a guess (KICKOFF DATA ENTRY / G12).
    const dupes = [{ displayName: "Jo Whitlam" }, { displayName: "Jo  Whitlam" }];
    expect(resolveName("Jo Whitlam", dupes)).toBeNull();
  });
});

describe("D22 — name normalisation (database half, app.normalise_name)", () => {
  let db: DbClient;
  beforeAll(async () => {
    db = await makeTestDb();
  }, 60_000);

  it("produces byte-identical output to the TypeScript half on every case", async () => {
    for (const [input, expected] of CASES) {
      const { rows } = await db.query<{ out: string }>(
        "SELECT app.normalise_name($1) AS out",
        [input],
      );
      expect({ input, out: rows[0]!.out }).toEqual({ input, out: expected });
      expect(rows[0]!.out).toBe(normaliseName(input));
    }
  });

  it("normalises on registry WRITE, whatever the client sends (D16 gatekeeper)", async () => {
    const season = "5ea50000-0000-4000-8000-0000000d2200";
    const player = "71a70000-0000-4000-8000-0000000d2201";
    await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
      season,
      "d22 season",
      JSON.stringify({ pricing: { floor: 9000 } }),
    ]);
    // A client that skipped normalisation entirely: curly apostrophe, NBSP,
    // doubled spaces, untrimmed.
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,$3,$4,'BAT',false,60000,true)`,
      [player, season, "  Adam O’Callaghan  ", "  Adam O’Callaghan  "],
    );
    const { rows } = await db.query<{ display_name: string; registry_key: string }>(
      "SELECT display_name, registry_key FROM players WHERE id = $1",
      [player],
    );
    expect(rows[0]!.display_name).toBe("Adam O'Callaghan");
    expect(rows[0]!.registry_key).toBe("Adam O'Callaghan");

    // ...so an inbound match attempt written in the OTHER apostrophe finds it.
    const hit = await db.query<{ id: string }>(
      "SELECT id FROM players WHERE season_id = $1 AND display_name = app.normalise_name($2)",
      [season, "Adam O'Callaghan"],
    );
    expect(hit.rows).toHaveLength(1);
  });

  it("refuses a second registry entry with the same normalised name", async () => {
    const season = "5ea50000-0000-4000-8000-0000000d2210";
    await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
      season,
      "dupe season",
      JSON.stringify({ pricing: { floor: 9000 } }),
    ]);
    const insert = (key: string, name: string) =>
      db.query(
        `INSERT INTO players (season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
         VALUES ($1,$2,$3,'BAT',false,60000,true)`,
        [season, key, name],
      );
    await insert("jo-whitlam", "Jo Whitlam");
    // Same person under a different apostrophe/spacing/case would be an
    // unresolvable inbound match forever after — refused at the registry instead.
    await expect(insert("jo-whitlam-2", "jo   whitlam")).rejects.toThrow();
  });
});

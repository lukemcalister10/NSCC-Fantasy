import { describe, it, expect } from "vitest";
import { parseCsv, parseRegistrySeed } from "../src/registry/csvImport.js";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";

/**
 * REGISTRY SEED CSV IMPORT (D23, kickoff scope 1a) — parse + REPRICE + cross-check.
 *
 * The binding rule under test: the file's `starting_price_reference` column is NOT
 * trusted. Every price is recomputed through the verified D4/G14 `startingPrice`
 * engine from `total_fantasy_pts_2526` / `g_matches_2526`, and disagreements are
 * surfaced rather than silently resolved either way.
 *
 * EVERY NAME HERE IS INVENTED (D17/Law 11): the real registry is club-member data,
 * is never committed to this public repo, and reaches the app only through the
 * operator's browser file picker at import time.
 *
 * Prices below are the FIXTURE economy ($/pt $1,000, floor $9,000, games cap 4,
 * nearest $100 half-up) — the same values G14 pins.
 */

const PRICING = FIXTURE_CONFIG.pricing;

const HEADER =
  "player,role,wk_eligible,g_matches_2526,total_fantasy_pts_2526,starting_price_reference";

describe("registry seed CSV — parsing", () => {
  it("handles quoted fields, doubled quotes, CRLF and a BOM", () => {
    const table = parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n');
    expect(table).toEqual([
      ["a", "b"],
      ["x,1", 'he said "hi"'],
    ]);
  });

  it("reports missing columns instead of importing a mangled file", () => {
    const res = parseRegistrySeed("player,role\nJo Whitlam,BAT\n", PRICING);
    expect(res.errors).toEqual([
      'missing required column "wk_eligible"',
      'missing required column "g_matches_2526"',
      'missing required column "total_fantasy_pts_2526"',
      'missing required column "starting_price_reference"',
    ]);
    expect(res.importable).toHaveLength(0);
  });
});

describe("registry seed CSV — repricing through the D4/G14 engine", () => {
  it("recomputes each price from points and games, not from the price column", () => {
    // 61-per-match players at g = 1/2/3/4 are G14's pinned ladder:
    // $22,000 / $35,000 / $48,000 / $61,000.
    const csv = [
      HEADER,
      "Jo Whitlam,BAT,,1,61,22000",
      "Priya Raman,BWL,,2,122,35000",
      "Tomas Reiner,AR,,3,183,48000",
      "Renée Dufort,BAT,,4,244,61000",
      "Sam Hollis,WK,y,6,366,61000", // g caps at 4 -> still $61,000
      "Mika Larsen,BWL,,0,0,9000", // zero history -> floor
      "Dev Anand,BAT,,4,20,9000", // avg 5 -> perf below floor -> clamps at floor
    ].join("\n");

    const res = parseRegistrySeed(csv, PRICING);
    expect(res.errors).toEqual([]);
    expect(res.importable).toHaveLength(7);
    expect(res.rows.map((r) => r.computedPrice)).toEqual([
      22_000, 35_000, 48_000, 61_000, 61_000, 9_000, 9_000,
    ]);
    // Every row agrees with its reference column, so nothing is flagged.
    expect(res.disagreements).toEqual([]);
  });

  it("FLAGS a row whose price column disagrees with the engine, and keeps the engine's value", () => {
    // 10 games, 994 points -> avg 99.4 -> perf $99,400, g >= 4 -> $99,400.
    // The file claims $94,900 (a transposition an operator would never spot by eye).
    const csv = [HEADER, "Brett Kowalczyk,AR,,10,994,94900"].join("\n");
    const res = parseRegistrySeed(csv, PRICING);

    const row = res.rows[0]!;
    expect(row.computedPrice).toBe(99_400);
    expect(row.referencePrice).toBe(94_900);
    expect(row.priceDisagrees).toBe(true);
    expect(res.disagreements).toHaveLength(1);
    // Still importable — the operator is shown the difference and decides; the
    // value that would be WRITTEN is the engine's.
    expect(res.importable).toHaveLength(1);
  });

  it("rounds half up, per D4, and tolerates $ and thousands separators", () => {
    // 4 games, 246.2 pts -> avg 61.55 -> perf $61,550 -> nearest $100, half UP.
    const csv = [HEADER, 'Ana Ferreira,BAT,,4,246.2,"$61,600"'].join("\n");
    const res = parseRegistrySeed(csv, PRICING);
    expect(res.rows[0]!.computedPrice).toBe(61_600);
    expect(res.rows[0]!.referencePrice).toBe(61_600);
    expect(res.rows[0]!.priceDisagrees).toBe(false);
  });

  it("prices against the SEASON's config, not a constant (G11)", () => {
    const halved = { ...PRICING, dollarsPerPoint: 500 };
    const csv = [HEADER, "Jo Whitlam,BAT,,4,244,61000"].join("\n");
    expect(parseRegistrySeed(csv, PRICING).rows[0]!.computedPrice).toBe(61_000);
    expect(parseRegistrySeed(csv, halved).rows[0]!.computedPrice).toBe(30_500);
  });
});

describe("registry seed CSV — rows the operator must fix before committing", () => {
  it("normalises names on the way in (D22) and shows what changed", () => {
    const csv = [HEADER, "  Adam O’Callaghan  ,BAT,,4,244,61000"].join("\n");
    const row = parseRegistrySeed(csv, PRICING).rows[0]!;
    expect(row.name).toBe("Adam O'Callaghan");
    expect(row.rawName).toBe("  Adam O’Callaghan  ");
    expect(row.errors).toEqual([]);
  });

  it("rejects an unknown role and points at the line", () => {
    const csv = [HEADER, "Jo Whitlam,ALLROUNDER,,4,244,61000"].join("\n");
    const res = parseRegistrySeed(csv, PRICING);
    expect(res.rows[0]!.errors).toEqual([
      'role "ALLROUNDER" is not one of BAT/WK/BWL/AR',
    ]);
    expect(res.importable).toHaveLength(0);
  });

  it("rejects a non-numeric games or points cell", () => {
    const csv = [HEADER, "Jo Whitlam,BAT,,n/a,244,61000", "Priya Raman,BAT,,4,—,61000"].join("\n");
    const res = parseRegistrySeed(csv, PRICING);
    expect(res.rows[0]!.errors[0]).toContain("g_matches_2526");
    expect(res.rows[1]!.errors[0]).toContain("total_fantasy_pts_2526");
    expect(res.importable).toHaveLength(0);
  });

  it("catches two rows that normalise to the same name, naming both lines", () => {
    const csv = [
      HEADER,
      "Jo Whitlam,BAT,,4,244,61000",
      "jo   whitlam,BWL,,2,40,19000",
    ].join("\n");
    const res = parseRegistrySeed(csv, PRICING);
    expect(res.rows[0]!.errors).toEqual([]);
    expect(res.rows[1]!.errors).toEqual(["duplicate of the player on line 2"]);
    expect(res.importable).toHaveLength(1);
  });

  it("reads wk_eligible as blank = false and y/yes/true = true", () => {
    const csv = [
      HEADER,
      "Jo Whitlam,BAT,,4,244,61000",
      "Priya Raman,BAT,yes,4,244,61000",
      "Tomas Reiner,BAT,maybe,4,244,61000",
    ].join("\n");
    const res = parseRegistrySeed(csv, PRICING);
    expect(res.rows[0]!.wkEligible).toBe(false);
    expect(res.rows[1]!.wkEligible).toBe(true);
    expect(res.rows[2]!.errors[0]).toContain("wk_eligible");
  });
});

describe("registry seed CSV — a 53-row file lands whole (D23 shape)", () => {
  it("parses and prices 53 invented rows with roles intact", () => {
    // Mirrors the D23 distribution (BAT 21 / BWL 15 / AR 13 / WK 4, 1 wk_eligible)
    // with INVENTED names — the real seed never enters this repository.
    const roles = [
      ...Array<string>(21).fill("BAT"),
      ...Array<string>(15).fill("BWL"),
      ...Array<string>(13).fill("AR"),
      ...Array<string>(4).fill("WK"),
    ];
    const lines = roles.map((role, i) => {
      const games = i % 5; // includes zero-history players
      const total = games * (10 + i);
      const wk = i === 3 ? "y" : ""; // exactly one wk_eligible non-WK
      return `Player ${String(i + 1).padStart(2, "0")} Invented,${role},${wk},${games},${total},`;
    });
    const res = parseRegistrySeed([HEADER, ...lines].join("\n"), PRICING);

    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(53);
    expect(res.importable).toHaveLength(53);
    expect(res.rows.filter((r) => r.role === "BAT")).toHaveLength(21);
    expect(res.rows.filter((r) => r.role === "BWL")).toHaveLength(15);
    expect(res.rows.filter((r) => r.role === "AR")).toHaveLength(13);
    expect(res.rows.filter((r) => r.role === "WK")).toHaveLength(4);
    expect(res.rows.filter((r) => r.wkEligible)).toHaveLength(1);
    // Zero-game players price at the floor; nobody prices below it.
    expect(res.rows.every((r) => r.computedPrice >= PRICING.floor)).toBe(true);
    expect(res.rows.filter((r) => r.games === 0).every((r) => r.computedPrice === 9_000)).toBe(true);
    // A blank reference column is not a disagreement — it is simply absent.
    expect(res.disagreements).toEqual([]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { ALT_CONFIG } from "./fixtures/alt-config.js";
import type { LeagueConfig } from "../src/config/types.js";
import type { RawSeason } from "../src/recompute/types.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { loadRawSeason } from "../src/db/repository.js";
import { makeTestDb, seedSeason, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";
import {
  CONFIG_FIELDS,
  LOCK_CATEGORIES,
  configLeafPaths,
  fieldPathKey,
  getConfigValue,
  setConfigValue,
  validateConfig,
  totalRoleMinimums,
  flexSlots,
  isArmed,
} from "../app/lib/seasonLock.js";

/**
 * /admin/settings CARRIES NO ECONOMY VALUES, AND EDITS IT MAKES ACTUALLY LAND.
 *
 * Three claims, proved together because separately none is worth much:
 *
 *   G11 DISCIPLINE, MECHANICALLY. The settings page renders one input per entry
 *   in CONFIG_FIELDS. If that list and LeagueConfig's own leaves ever disagree,
 *   a parameter is either un-editable on the page or invented by it — so the
 *   first test walks the config's actual structure and demands an exact match in
 *   both directions. A config key added in a later slice cannot quietly become
 *   un-editable: this fails until a descriptor exists for it.
 *
 *   NO VALUES IN CODE. The page reads every value out of `seasons.config`. The
 *   round-trip test proves it the only way that means anything: for two fully
 *   distinct economies, reading each field through the page's own accessor and
 *   writing it back through the page's own setter reproduces the input config
 *   exactly. A default hidden anywhere in the descriptor layer would show up as
 *   a difference.
 *
 *   THE EDIT PROPAGATES (slice DoD, first bullet). A change made the way the page
 *   makes it — setConfigValue, then the single-column write saveSeasonConfig
 *   issues — reaches the recompute and changes a score.
 *
 * The DATABASE is still the gatekeeper (D16): validateConfig here only explains
 * a problem earlier than the round-trip would, and where it and 0003 could
 * disagree, 0003 is right. The last test hunts that disagreement.
 */

const SEASON = "00000000-0000-0000-0000-000000005000";
const MANAGER = "00000000-0000-0000-0000-000000005001";
const ROUND = "00000000-0000-0000-0000-000000005002";
const MATCH = "00000000-0000-0000-0000-000000005003";
const SC = "00000000-0000-0000-0000-000000005004";
const A = "00000000-0000-0000-0000-000000005005";

const CONFIGS: { name: string; config: LeagueConfig }[] = [
  { name: "FIXTURE_CONFIG", config: FIXTURE_CONFIG },
  { name: "ALT_CONFIG", config: ALT_CONFIG },
];

// ---------------------------------------------------------------------------
// Coverage: the page's field list === the config's own shape
// ---------------------------------------------------------------------------

describe("the settings page exposes exactly the economy the config carries", () => {
  it.each(CONFIGS)("$name: every leaf has an input, and every input a leaf", ({ config }) => {
    const leaves = configLeafPaths(config).sort();
    const described = CONFIG_FIELDS.map((f) => fieldPathKey(f.path)).sort();

    const missing = leaves.filter((l) => !described.includes(l));
    const invented = described.filter((d) => !leaves.includes(d));

    // Named rather than counted, so a failure says WHICH parameter.
    expect({ missing, invented }).toEqual({ missing: [], invented: [] });
  });

  it("every field cites the decision that governs it (Standing Rule 2)", () => {
    const unlabelled = CONFIG_FIELDS.filter((f) => !/^[A-Z]\d/.test(f.decision));
    expect(unlabelled.map((f) => fieldPathKey(f.path))).toEqual([]);
  });

  it("only the salary cap is computed rather than typed — it is not an input (O3)", () => {
    const computed = CONFIG_FIELDS.filter((f) => f.computedAtLock).map((f) => fieldPathKey(f.path));
    expect(computed).toEqual(["squad.cap"]);
  });
});

// ---------------------------------------------------------------------------
// No values in code
// ---------------------------------------------------------------------------

describe("no economy value is written into the page", () => {
  it.each(CONFIGS)(
    "$name: reading every field and writing it back reproduces the config exactly",
    ({ config }) => {
      // Start from a config whose every leaf is deliberately WRONG, so anything
      // the round-trip fails to carry across shows up rather than being masked
      // by an identical starting value.
      const scrambled = CONFIG_FIELDS.reduce(
        (acc, f) => setConfigValue(acc, f.path, -1),
        config,
      );
      const rebuilt = CONFIG_FIELDS.reduce(
        (acc, f) => setConfigValue(acc, f.path, getConfigValue(config, f.path)!),
        scrambled,
      );
      expect(rebuilt).toEqual(config);
    },
  );

  it("the two economies really are different, so the sweep above means something", () => {
    const differing = CONFIG_FIELDS.filter(
      (f) => getConfigValue(FIXTURE_CONFIG, f.path) !== getConfigValue(ALT_CONFIG, f.path),
    );
    // Not "some differ" — most must, or the round-trip could be passing on luck.
    expect(differing.length).toBeGreaterThan(CONFIG_FIELDS.length / 2);
  });
});

// ---------------------------------------------------------------------------
// The edit propagates
// ---------------------------------------------------------------------------

function buildRaw(config: LeagueConfig): RawSeason {
  return {
    seasonId: SEASON,
    config,
    players: [
      { id: A, registryKey: "a", displayName: "A", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
    ],
    rounds: [{ id: ROUND, seq: 1, name: "R1", lockAt: "2099-01-01T00:00:00Z" }],
    matches: [
      { id: MATCH, roundId: ROUND, grade: "A", opponent: "Opp", status: "finalised", finalDayDate: "2026-10-04", finalisedAt: "2026-10-04T06:00:00Z" },
    ],
    scorecards: [
      {
        id: SC,
        matchId: MATCH,
        wicketKeeperPlayerId: null,
        reviewState: "committed",
        lineup: [A],
        batting: [{ playerId: A, innings: 1, runs: 100, ballsFaced: 100, fours: 0, sixes: 0, notOut: false }],
        bowling: [],
        dismissals: [],
      },
    ],
    fantasyTeams: [],
    selections: [],
    trades: [],
  };
}

const baseOfA = async (db: DbClient): Promise<number> =>
  recomputeSeason(await loadRawSeason(db, SEASON)).playerMatchScores.find(
    (s) => s.playerId === A,
  )!.base;

describe("an edit made the way the page makes it reaches the recompute", () => {
  it("changing a scoring value on the settings page changes what a match scores (D13)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw(FIXTURE_CONFIG));
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'manager',true)",
      [MANAGER],
    );

    const perRun = FIXTURE_CONFIG.scoring.perRun;
    expect(await baseOfA(db)).toBe(100 * perRun);

    // Exactly what the page does: take the loaded config, set one leaf by path,
    // write the WHOLE config back in one column (saveSeasonConfig's shape), as
    // the signed-in manager under RLS.
    const edited = setConfigValue(FIXTURE_CONFIG, ["scoring", "perRun"], perRun * 2);
    await asAuthed(db, { role: "authenticated", sub: MANAGER }, () =>
      db.query("UPDATE seasons SET config = $2 WHERE id = $1", [SEASON, JSON.stringify(edited)]),
    );

    expect(await baseOfA(db)).toBe(100 * perRun * 2);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Pre-flight validation, and its agreement with the database
// ---------------------------------------------------------------------------

describe("the page's pre-flight validation", () => {
  it.each(CONFIGS)("$name: a real season config is clean", ({ config }) => {
    expect(validateConfig(config)).toEqual([]);
  });

  it("reports role minimums that do not fit inside the team (O2/A7)", () => {
    const teamSize = FIXTURE_CONFIG.squad.teamSize;
    const overfull = setConfigValue(FIXTURE_CONFIG, ["squad", "roleMinimums", "BAT"], teamSize + 1);
    const problems = validateConfig(overfull);
    expect(problems.map((p) => p.path)).toContain("squad.roleMinimums");
    expect(flexSlots(overfull)).toBeLessThan(0);
    expect(totalRoleMinimums(overfull)).toBeGreaterThan(teamSize);
  });

  it("rejects a non-integer count and an α outside 0..1", () => {
    const fractional = setConfigValue(FIXTURE_CONFIG, ["squad", "teamSize"], 6.5);
    expect(validateConfig(fractional).map((p) => p.path)).toContain("squad.teamSize");

    const wildAlpha = setConfigValue(FIXTURE_CONFIG, ["pricing", "alpha"], 2);
    expect(validateConfig(wildAlpha).map((p) => p.path)).toContain("pricing.alpha");
  });

  it("agrees with the database: a config the page passes, 0003 also accepts", async () => {
    // Mirror fidelity, in the direction that matters. The page must never wave
    // through an economy the composition guard will then reject at a
    // participant's first save — the operator would never see the error.
    const db = await makeTestDb();
    await seedSeason(db, buildRaw(FIXTURE_CONFIG));
    expect(validateConfig(FIXTURE_CONFIG)).toEqual([]);

    const { rows } = await db.query<{ n: string }>(
      `SELECT ((config #>> '{squad,teamSize}')::int
               - ((config #>> '{squad,roleMinimums,BAT}')::int
                + (config #>> '{squad,roleMinimums,WK}')::int
                + (config #>> '{squad,roleMinimums,BWL}')::int
                + (config #>> '{squad,roleMinimums,AR}')::int)) AS n
         FROM seasons WHERE id = $1`,
      [SEASON],
    );
    // The database's own view of the flex remainder matches the page's.
    expect(Number(rows[0]!.n)).toBe(flexSlots(FIXTURE_CONFIG));
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The one-way door's arming, and the freeze table's honesty
// ---------------------------------------------------------------------------

describe("arming the lock is deliberate, not a click-through", () => {
  const NAME = "2026/27 Season";

  it("arms only on the season's name, ignoring surrounding whitespace and case", () => {
    expect(isArmed(NAME, NAME)).toBe(true);
    expect(isArmed(`  ${NAME.toLowerCase()}  `, NAME)).toBe(true);
  });

  it("does not arm on an empty box, a partial name, or a generic confirmation", () => {
    for (const typed of ["", "  ", "2026", "2026/27", "yes", "OK", "lock"]) {
      expect(isArmed(typed, NAME)).toBe(false);
    }
  });
});

describe("the freeze table on the rehearsal panel is not decorative", () => {
  const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const allSql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(new URL(f, `file://${MIGRATIONS}`), "utf8"))
    .join("\n");

  it("every trigger it names as the enforcer actually exists in the migrations", () => {
    const missing = LOCK_CATEGORIES.filter(
      (c) => !new RegExp(`CREATE TRIGGER\\s+${c.enforcedBy}\\b`).test(allSql),
    );
    expect(missing.map((c) => `${c.key} -> ${c.enforcedBy}`)).toEqual([]);
  });

  it("covers the categories KICKOFF's SEASON LOCK paragraph lists, including D21", () => {
    const keys = LOCK_CATEGORIES.map((c) => c.key);
    for (const required of [
      "league-settings",
      "scoring",
      "starting-prices",
      "roles",
      "wk-eligible",
      "alpha",
      "floor",
      "dollars-per-point",
      "trades-per-round",
      "team-registration",
    ]) {
      expect(keys).toContain(required);
    }
  });
});

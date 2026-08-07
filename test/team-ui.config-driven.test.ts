import { describe, expect, it, beforeAll } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { ALT_CONFIG } from "./fixtures/alt-config.js";
import type { LeagueConfig } from "../src/config/types.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";
import {
  flexSlots,
  tradeBudget,
  totalMinimums,
  validateComposition,
  type RoleCarrier,
  type TradeRow,
} from "../app/lib/squad.js";

/**
 * THE UI CARRIES NO ECONOMY CONSTANTS, AND ITS MIRROR IS FAITHFUL.
 *
 * Two claims, proved together, because separately neither is worth much:
 *
 *   G11 DISCIPLINE, APPLIED TO THE UI — composition and trade limits change
 *   correctly when config values change, with NO code change. Every assertion
 *   below is derived from the config object; the same test body runs against two
 *   fully distinct economies (teamSize 6 with BAT≥2/WK≥1/BWL≥2/AR≥1 and
 *   tradesPerRound 2, versus teamSize 5 with BAT≥2/WK≥1/BWL≥1/AR≥1 and
 *   tradesPerRound 3).
 *
 *   MIRROR FIDELITY — for the SAME inputs, the client-side check in
 *   `app/lib/squad.ts` reaches the same verdict as the database trigger in
 *   0003_selection_validation.sql. The client check exists only so the UI can
 *   explain itself before the round-trip; if the two ever disagree the DATABASE
 *   is right and the mirror is the bug, so the disagreement is what this test
 *   hunts for. Squads are sampled pseudo-randomly (fixed seed, so failures
 *   reproduce) across sizes teamSize−1, teamSize and teamSize+1.
 */

const SEASON = "00000000-0000-0000-0000-00000000d000";
const ROUND = "00000000-0000-0000-0000-00000000d001";
const R2 = "00000000-0000-0000-0000-00000000d002";
const OWNER = "00000000-0000-0000-0000-00000000d0a0";
const FT = "00000000-0000-0000-0000-00000000d0b0";

const PRICE = 50_000;

interface PoolEntry {
  id: string;
  role: "BAT" | "WK" | "BWL" | "AR";
  wkEligible: boolean;
}

/** A pool broad enough for either config, with wk_eligible players in two roles. */
const POOL: PoolEntry[] = [
  { id: "00000000-0000-0000-0000-00000000d101", role: "BAT", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d102", role: "BAT", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d103", role: "BAT", wkEligible: true },
  { id: "00000000-0000-0000-0000-00000000d104", role: "BAT", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d105", role: "WK", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d106", role: "WK", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d107", role: "BWL", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d108", role: "BWL", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d109", role: "BWL", wkEligible: true },
  { id: "00000000-0000-0000-0000-00000000d10a", role: "BWL", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d10b", role: "AR", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d10c", role: "AR", wkEligible: false },
  { id: "00000000-0000-0000-0000-00000000d10d", role: "AR", wkEligible: false },
];
const byId = new Map(POOL.map((p) => [p.id, p]));
const carriersOf = (ids: string[]): RoleCarrier[] =>
  ids.map((id) => ({ role: byId.get(id)!.role, wk_eligible: byId.get(id)!.wkEligible }));

function buildRaw(config: LeagueConfig): RawSeason {
  return {
    seasonId: SEASON,
    config,
    players: POOL.map((p, i) => ({
      id: p.id,
      registryKey: `p${i}`,
      displayName: `P${i}`,
      role: p.role,
      wkEligible: p.wkEligible,
      startingPrice: PRICE,
      active: true,
    })),
    rounds: [
      { id: ROUND, seq: 1, name: "R1", lockAt: "2099-01-01T00:00:00Z" },
      { id: R2, seq: 2, name: "R2", lockAt: "2099-01-01T00:00:00Z" },
    ],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

/** Deterministic PRNG — a failing sample must reproduce exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(rand: () => number, size: number): string[] {
  const bag = [...POOL];
  const out: string[] = [];
  for (let i = 0; i < size && bag.length > 0; i++) {
    out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]!.id);
  }
  return out;
}

let uidSeq = 0;
const uid = () =>
  // The final uuid group is exactly 12 hex digits — 6 fixed, 6 counter.
  `00000000-0000-0000-0000-0000f0${(uidSeq++).toString(16).padStart(6, "0")}`;

/**
 * Attempt the UI's write shape (one multi-row INSERT of the whole set), and
 * report the database's OWN message on refusal — a disagreement is only useful
 * if it says which constraint spoke.
 */
async function dbAccepts(
  db: DbClient,
  players: string[],
): Promise<{ ok: boolean; message: string }> {
  const values = players
    .map(
      (_, i) =>
        `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`,
    )
    .join(",");
  const params = players.flatMap((p, i) => [uid(), FT, ROUND, p, i === 0, i === 1]);
  await db.query("BEGIN");
  try {
    await db.query(
      `INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ${values}`,
      params,
    );
    await db.query("COMMIT");
    // Leave the table as we found it: emptying the whole set is legal (n = 0 is
    // skipped by both deferred guards), which is exactly why repair is possible.
    await db.query("DELETE FROM selections WHERE fantasy_team_id = $1 AND round_id = $2", [
      FT,
      ROUND,
    ]);
    return { ok: true, message: "" };
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* already aborted */
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const CONFIGS: { name: string; config: LeagueConfig }[] = [
  { name: "FIXTURE_CONFIG", config: FIXTURE_CONFIG },
  { name: "ALT_CONFIG", config: ALT_CONFIG },
];

describe.each(CONFIGS)("$name — the UI mirror agrees with the database", ({ config }) => {
  const squad = config.squad;
  let db: DbClient;

  beforeAll(async () => {
    db = await makeTestDb();
    await seedSeason(db, buildRaw(config));
  }, 60_000);

  it("the config is self-consistent (minimums fit inside the team)", () => {
    expect(totalMinimums(squad)).toBeLessThanOrEqual(squad.teamSize);
    expect(flexSlots(squad)).toBe(squad.teamSize - totalMinimums(squad));
  });

  it(
    "client verdict === database verdict across sampled squads of three sizes",
    async () => {
      const rand = mulberry32(20260807);
      const sizes = [squad.teamSize - 1, squad.teamSize, squad.teamSize + 1];
      const disagreements: string[] = [];
      let accepted = 0;
      let rejected = 0;

      for (let i = 0; i < 12; i++) {
        for (const size of sizes) {
          const players = sample(rand, size);
          if (players.length !== size) continue; // pool exhausted
          const clientProblems = validateComposition(carriersOf(players), squad);
          const clientOk = clientProblems.length === 0;
          const { ok: dbOk, message } = await dbAccepts(db, players);
          if (clientOk !== dbOk) {
            disagreements.push(
              `size ${size}: client ${clientOk ? "accept" : "reject"} vs db ${
                dbOk ? "accept" : "reject"
              } for [${players
                .map((p) => `${byId.get(p)!.role}${byId.get(p)!.wkEligible ? "+wk" : ""}`)
                .join(", ")}] — db said: ${message || "(accepted)"} — client said: ${
                clientProblems.map((p) => p.constraint).join("/") || "(legal)"
              }`,
            );
          }
          if (dbOk) accepted++;
          else rejected++;
        }
      }

      expect(disagreements).toEqual([]);
      // The sample must actually exercise BOTH verdicts, or agreement is vacuous.
      expect(accepted).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);
    },
    120_000,
  );

  it("a squad of exactly the configured minimums plus flex is legal", () => {
    const picks: string[] = [];
    for (const role of ["BAT", "WK", "BWL", "AR"] as const) {
      const need = squad.roleMinimums[role] ?? 0;
      picks.push(...POOL.filter((p) => p.role === role).slice(0, need).map((p) => p.id));
    }
    // Fill the flex remainder with whatever is left — it is a true wildcard.
    const rest = POOL.filter((p) => !picks.includes(p.id));
    picks.push(...rest.slice(0, squad.teamSize - picks.length).map((p) => p.id));

    expect(picks).toHaveLength(squad.teamSize);
    expect(validateComposition(carriersOf(picks), squad)).toEqual([]);
  });

  it("the trade budget follows tradesPerRound from config, with the founding exemption", () => {
    const roundSeqById = new Map([
      [ROUND, 1],
      [R2, 2],
    ]);
    const trade = (roundId: string, kind: "buy" | "sell", i: number): TradeRow => ({
      id: `t${i}`,
      fantasy_team_id: FT,
      kind,
      player_id: POOL[i % POOL.length]!.id,
      price: PRICE,
      round_id: roundId,
      created_at: `2026-09-01T00:00:${String(i).padStart(2, "0")}Z`,
    });

    // No prior-round trades at all → founding build, count exempt.
    const founding = Array.from({ length: squad.teamSize }, (_, i) =>
      trade(ROUND, "buy", i),
    );
    const foundingBudget = tradeBudget(founding, ROUND, roundSeqById, squad);
    expect(foundingBudget.initialBuild).toBe(true);
    expect(foundingBudget.remaining).toBeNull();

    // With a prior round on the ledger, round 2's buys are counted trade-ins.
    const withPrior = [
      ...founding,
      ...Array.from({ length: squad.tradesPerRound }, (_, i) =>
        trade(R2, "buy", i + squad.teamSize),
      ),
    ];
    const r2Budget = tradeBudget(withPrior, R2, roundSeqById, squad);
    expect(r2Budget.initialBuild).toBe(false);
    expect(r2Budget.limit).toBe(squad.tradesPerRound);
    expect(r2Budget.used).toBe(squad.tradesPerRound);
    expect(r2Budget.remaining).toBe(0);
  });
});

describe("the two economies really are different, so the sweep above means something", () => {
  it("team size, role minimums and trade limits all differ between configs", () => {
    expect(ALT_CONFIG.squad.teamSize).not.toBe(FIXTURE_CONFIG.squad.teamSize);
    expect(ALT_CONFIG.squad.tradesPerRound).not.toBe(FIXTURE_CONFIG.squad.tradesPerRound);
    expect(ALT_CONFIG.squad.roleMinimums).not.toEqual(FIXTURE_CONFIG.squad.roleMinimums);
    expect(ALT_CONFIG.squad.cap).not.toBe(FIXTURE_CONFIG.squad.cap);
  });
});

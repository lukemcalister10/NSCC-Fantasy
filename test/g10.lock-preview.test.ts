import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { LeagueConfig } from "../src/config/types.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * THE REHEARSAL PREVIEW IS THE LOCK'S OWN ARITHMETIC (O3 / KICKOFF §SEASON LOCK).
 *
 * KICKOFF says to rehearse the lock on a scratch season before firing it on the
 * real one, which is only worth anything if the rehearsal is FAITHFUL. The naive
 * way to build it — compute the cap in the client and hope it matches the trigger
 * — creates two implementations of the O3 mean and the D4 rounding, and the
 * rehearsal silently stops being a rehearsal the first time they diverge.
 *
 * So migration 0008 factors the arithmetic into app.season_pool_stats() and the
 * refusal into app.season_lock_blocker(), and BOTH the preview
 * (public.season_lock_preview) and enforce_season_lock() call them. This file
 * proves the property that buys: for every pool below, the cap the preview
 * PROMISES is byte-identical to the cap the lock then WRITES, and the reason the
 * preview gives for refusing is the reason the lock raises.
 *
 * It also covers the three defects found while reading 0002:
 *   * an empty pool used to die on "null value in column config" (NULL cap ->
 *     jsonb_set returns NULL -> NOT NULL violation) and now names itself
 *   * a config missing squad.teamSize / pricing.roundingIncrement, likewise
 *   * the $100 rounding step was a literal in 0002 and is now read from
 *     pricing.roundingIncrement (G11), proven by moving it
 *
 * …and the pool-removal mechanism the operator ruled in on 10/08/2026, which is
 * what lets "the mean over ALL players" stay literally true at lock.
 */

const SEASON = "00000000-0000-0000-0000-00000000f000";
const MANAGER = "00000000-0000-0000-0000-00000000f0a0";
const ROUND = "00000000-0000-0000-0000-00000000f0c0";
const MATCH = "00000000-0000-0000-0000-00000000f0c1";
const SC = "00000000-0000-0000-0000-00000000f0c2";

const pid = (n: number) =>
  `00000000-0000-0000-0000-00000000f1${n.toString(16).padStart(2, "0")}`;

interface PoolSpec {
  price: number | null;
  active?: boolean;
}

function buildRaw(pool: PoolSpec[], config: LeagueConfig = FIXTURE_CONFIG): RawSeason {
  return {
    seasonId: SEASON,
    config,
    players: pool.map((p, i) => ({
      id: pid(i),
      registryKey: `p${i}`,
      displayName: `P${i}`,
      role: "BAT" as const,
      wkEligible: false,
      startingPrice: p.price,
      active: p.active ?? true,
    })),
    rounds: [],
    matches: [],
    scorecards: [],
    fantasyTeams: [],
    selections: [],
    trades: [],
  };
}

/** Deep-clone the fixture and move one leaf — no economy value written by hand. */
function withConfig(mutate: (c: LeagueConfig) => void): LeagueConfig {
  const c = JSON.parse(JSON.stringify(FIXTURE_CONFIG)) as LeagueConfig;
  mutate(c);
  return c;
}

async function seeded(pool: PoolSpec[], config?: LeagueConfig): Promise<DbClient> {
  const db = await makeTestDb();
  await seedSeason(db, buildRaw(pool, config));
  await db.query(
    "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'manager',true)",
    [MANAGER],
  );
  return db;
}

const asManager = <T>(db: DbClient, fn: () => Promise<T>) =>
  asAuthed(db, { role: "authenticated", sub: MANAGER }, fn);

interface PreviewRow {
  pool_size: number;
  priced_count: number;
  unpriced_count: number;
  active_count: number;
  inactive_count: number;
  mean_starting_price: string | null;
  computed_cap: string | number | null;
  at_floor_count: number;
  lockable: boolean;
  blocker: string | null;
  current_cap: string | number | null;
}

/** Read the preview exactly as the settings page does — through the RPC. */
async function preview(db: DbClient): Promise<PreviewRow> {
  const { rows } = await db.query<PreviewRow>("SELECT * FROM season_lock_preview($1)", [SEASON]);
  return rows[0]!;
}

const capOf = async (db: DbClient): Promise<number | null> => {
  const { rows } = await db.query<{ cap: string | null }>(
    "SELECT (config #>> '{squad,cap}')::bigint AS cap FROM seasons WHERE id = $1",
    [SEASON],
  );
  const v = rows[0]!.cap;
  return v === null ? null : Number(v);
};

const lock = (db: DbClient) =>
  asManager(db, () => db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]));

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

// ---------------------------------------------------------------------------
// Preview fidelity
// ---------------------------------------------------------------------------

/**
 * HAND-WORKED ARITHMETIC for each pool. mean = Σ prices / n; raw = teamSize ×
 * mean; cap = raw rounded to the nearest increment, halves UP (D4/G14).
 * FIXTURE_CONFIG supplies teamSize 6 and increment $100.
 */
const POOLS: { name: string; prices: number[]; expectedCap: number }[] = [
  {
    // The O3 dynamic: one star, three at/near the floor pulling the mean down.
    // Σ = 77,100 · mean = 19,275 · raw = 115,650 · lands EXACTLY on the $x50
    // boundary between 115,600 and 115,700 → halves up → 115,700.
    name: "a $x50 boundary — the half-up case",
    prices: [50_000, 9_000, 9_000, 9_100],
    expectedCap: 115_700,
  },
  {
    // Σ = 120,000 · mean = 30,000 · raw = 180,000 — already on an increment.
    name: "an exact multiple of the increment",
    prices: [40_000, 30_000, 30_000, 20_000],
    expectedCap: 180_000,
  },
  {
    // Σ = 100,000 · mean = 33,333.33… · raw = 199,999.99… → 200,000.
    name: "a recurring mean, rounded up to the increment",
    prices: [50_000, 25_000, 25_000],
    expectedCap: 200_000,
  },
  {
    // Σ = 27,100 · mean = 9,033.33… · raw = 54,200 — a floor-heavy pool, which
    // is exactly the A9 warning: newcomers drag the cap down.
    name: "a floor-heavy pool (the A9 warning, arithmetically)",
    prices: [9_000, 9_000, 9_100],
    expectedCap: 54_200,
  },
];

describe("the preview promises the cap the lock then writes", () => {
  for (const pool of POOLS) {
    it(
      `${pool.name}: preview === lock === hand calculation`,
      async () => {
        const db = await seeded(pool.prices.map((price) => ({ price })));

        const before = await preview(db);
        expect(before.lockable).toBe(true);
        expect(before.blocker).toBeNull();
        // The hand calculation in the table above.
        expect(num(before.computed_cap)).toBe(pool.expectedCap);
        // Pre-lock the stored cap is still the placeholder, so the promise is
        // about a value that does not yet exist anywhere.
        expect(num(before.current_cap)).toBe(FIXTURE_CONFIG.squad.cap);

        await expect(lock(db)).resolves.toBeDefined();

        // What the lock actually wrote === what the preview promised.
        expect(await capOf(db)).toBe(num(before.computed_cap));
        expect(await capOf(db)).toBe(pool.expectedCap);
      },
      60_000,
    );
  }

  it("reports the pool figures the operator is asked to judge the cap on (O3/A9)", async () => {
    const db = await seeded([
      { price: 50_000 },
      { price: 9_000 },
      { price: 9_000 },
      { price: 9_100, active: false },
    ]);
    const p = await preview(db);
    expect(p.pool_size).toBe(4);
    expect(p.priced_count).toBe(4);
    expect(p.unpriced_count).toBe(0);
    expect(p.active_count).toBe(3);
    expect(p.inactive_count).toBe(1); // still counted in the mean — O3 is literal
    expect(Number(p.mean_starting_price)).toBe(19_275);
    expect(p.at_floor_count).toBe(2); // exactly at FIXTURE floor $9,000
  }, 60_000);

  it("says the season is already locked once it is, and offers no way back", async () => {
    const db = await seeded([{ price: 50_000 }, { price: 10_000 }]);
    await lock(db);
    const p = await preview(db);
    expect(p.lockable).toBe(false);
    expect(p.blocker).toMatch(/already locked/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Blockers — the preview's words are the lock's words
// ---------------------------------------------------------------------------

describe("every refusal is named, and named identically in both places", () => {
  it("an unpriced player blocks the lock and is explained, not just refused (C13)", async () => {
    const db = await seeded([{ price: 50_000 }, { price: null }, { price: 9_000 }]);

    const p = await preview(db);
    expect(p.lockable).toBe(false);
    expect(p.unpriced_count).toBe(1);
    expect(p.blocker).toMatch(/NULL starting_price/);
    // The preview refuses to promise a cap it cannot honestly compute…
    // (the mean over the priced subset would silently exclude the unpriced player)
    expect(p.blocker).toMatch(/materialise/);

    // …and the lock raises the SAME text.
    await expect(lock(db)).rejects.toThrow(p.blocker!.slice(0, 40));

    // Price the straggler: both the preview and the lock come good.
    await asManager(db, () =>
      db.query("UPDATE players SET starting_price = 10000 WHERE id = $1", [pid(1)]),
    );
    const after = await preview(db);
    expect(after.lockable).toBe(true);
    expect(after.blocker).toBeNull();
    await expect(lock(db)).resolves.toBeDefined();
    expect(await capOf(db)).toBe(num(after.computed_cap));
  }, 60_000);

  it("an empty pool is refused legibly, not as a NOT NULL violation", async () => {
    const db = await seeded([]);
    const p = await preview(db);
    expect(p.pool_size).toBe(0);
    expect(p.lockable).toBe(false);
    expect(p.blocker).toMatch(/pool is empty/);

    await expect(lock(db)).rejects.toThrow(/pool is empty/);
    // The old failure mode, explicitly ruled out.
    await expect(lock(db)).rejects.not.toThrow(/null value in column/);
    // …and the config survived the refusal intact.
    expect(await capOf(db)).toBe(FIXTURE_CONFIG.squad.cap);
  }, 60_000);

  it("a config missing squad.teamSize names the missing key", async () => {
    const db = await seeded([{ price: 50_000 }]);
    await db.query("UPDATE seasons SET config = config #- '{squad,teamSize}' WHERE id = $1", [
      SEASON,
    ]);
    const p = await preview(db);
    expect(p.lockable).toBe(false);
    expect(p.blocker).toMatch(/squad\.teamSize/);
    await expect(lock(db)).rejects.toThrow(/squad\.teamSize/);
  }, 60_000);

  it("a config missing pricing.roundingIncrement names the missing key", async () => {
    const db = await seeded([{ price: 50_000 }]);
    await db.query(
      "UPDATE seasons SET config = config #- '{pricing,roundingIncrement}' WHERE id = $1",
      [SEASON],
    );
    const p = await preview(db);
    expect(p.lockable).toBe(false);
    expect(p.blocker).toMatch(/roundingIncrement/);
    await expect(lock(db)).rejects.toThrow(/roundingIncrement/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// G11: the rounding step is config, not a literal
// ---------------------------------------------------------------------------

describe("G11 — the cap's rounding step comes from config, with no code change", () => {
  it("moving pricing.roundingIncrement moves the cap the lock computes", async () => {
    // Same pool as the boundary case: mean 19,275 · teamSize 6 · raw 115,650.
    //   increment $100  -> 115,650 / 100 = 1,156.5 -> +0.5 -> floor 1,157 -> 115,700
    //   increment $1000 -> 115,650 / 1000 = 115.65 -> +0.5 -> floor 116   -> 116,000
    const prices = [50_000, 9_000, 9_000, 9_100].map((price) => ({ price }));
    const config = withConfig((c) => {
      c.pricing.roundingIncrement = FIXTURE_CONFIG.pricing.roundingIncrement * 10;
    });

    const db = await seeded(prices, config);
    const p = await preview(db);
    expect(num(p.computed_cap)).toBe(116_000);
    await lock(db);
    expect(await capOf(db)).toBe(116_000);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Pool removal (operator ruling, 10/08/2026)
// ---------------------------------------------------------------------------

describe("removing a withdrawn registrant from the pool before lock", () => {
  it("removes a historyless player, moves the mean, and moves the cap with it", async () => {
    // P3 is an inactive floor-priced registrant dragging the mean down (A9).
    const db = await seeded([
      { price: 50_000 },
      { price: 9_000 },
      { price: 9_000 },
      { price: 9_100, active: false },
    ]);
    const before = await preview(db);
    expect(before.pool_size).toBe(4);
    expect(num(before.computed_cap)).toBe(115_700);

    await expect(
      asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(3)])),
    ).resolves.toBeDefined();

    // Σ = 68,000 · mean = 22,666.67 · raw = 136,000 → cap 136,000.
    const after = await preview(db);
    expect(after.pool_size).toBe(3);
    expect(after.inactive_count).toBe(0);
    expect(num(after.computed_cap)).toBe(136_000);

    await lock(db);
    expect(await capOf(db)).toBe(136_000); // the removal is what the lock froze
  }, 60_000);

  it("writes the removal to the registry audit log, since it moves the cap", async () => {
    const db = await seeded([{ price: 50_000 }, { price: 9_000, active: false }]);
    await asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(1)]));
    const { rows } = await db.query<{ event: string; detail: Record<string, unknown> }>(
      "SELECT event, detail FROM player_registry_events WHERE event = 'delete'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail["display_name"]).toBe("P1");
    expect(rows[0]!.detail["removed_from_pool"]).toBe(true);
  }, 60_000);

  it("refuses a player with raw history, naming what blocks it (D15)", async () => {
    const db = await seeded([{ price: 50_000 }, { price: 9_000 }]);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'R1','2099-01-01T00:00:00Z')",
      [ROUND, SEASON],
    );
    await db.query(
      "INSERT INTO matches (id, round_id, grade, opponent, status) VALUES ($1,$2,'A','Opp','finalised')",
      [MATCH, ROUND],
    );
    await db.query("INSERT INTO scorecards (id, match_id) VALUES ($1,$2)", [SC, MATCH]);
    await db.query("INSERT INTO scorecard_lineup (scorecard_id, player_id) VALUES ($1,$2)", [
      SC,
      pid(0),
    ]);

    await expect(
      asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(0)])),
    ).rejects.toThrow(/named in a match lineup/);
  }, 60_000);

  it("refuses a player credited only in a dismissal string, which no foreign key guards (D25)", async () => {
    // The subtle one. dismissals.resolved_text carries player ids as TEXT, so a
    // fielder who never batted, bowled or made the lineup has NO foreign key
    // pointing at them — a plain DELETE would leave a dangling fielding credit
    // and score it as nobody's, silently. That is the D25 defect's shape exactly.
    const db = await seeded([{ price: 50_000 }, { price: 9_000 }]);
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'R1','2099-01-01T00:00:00Z')",
      [ROUND, SEASON],
    );
    await db.query(
      "INSERT INTO matches (id, round_id, grade, opponent, status) VALUES ($1,$2,'A','Opp','finalised')",
      [MATCH, ROUND],
    );
    await db.query("INSERT INTO scorecards (id, match_id) VALUES ($1,$2)", [SC, MATCH]);
    await db.query(
      "INSERT INTO dismissals (scorecard_id, seq, resolved_text) VALUES ($1,0,$2)",
      [SC, `c ${pid(1)} b ${pid(0)}`],
    );

    await expect(
      asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(1)])),
    ).rejects.toThrow(/dismissal string/);
  }, 60_000);

  it("refuses any removal once the season is locked, pointing at the active flag instead", async () => {
    const db = await seeded([{ price: 50_000 }, { price: 9_000, active: false }]);
    await lock(db);
    await expect(
      asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(1)])),
    ).rejects.toThrow(/is locked; player .* cannot be removed from the pool/);
    // The cap the lock computed still describes the pool it was computed over.
    expect(await capOf(db)).toBe(177_000); // mean 29,500 × 6
  }, 60_000);

  it("clears a removed player's stale derived rows rather than tripping their foreign keys", async () => {
    const db = await seeded([{ price: 50_000 }, { price: 9_000 }]);
    // A previous recompute left a seq-0 price seed for every player — which is
    // why "has derived rows" must NOT be read as "has history".
    await db.query(
      "INSERT INTO price_history (player_id, match_id, seq, price) VALUES ($1, NULL, 0, 9000)",
      [pid(1)],
    );
    await expect(
      asManager(db, () => db.query("DELETE FROM players WHERE id = $1", [pid(1)])),
    ).resolves.toBeDefined();
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM price_history WHERE player_id = $1",
      [pid(1)],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  }, 60_000);
});

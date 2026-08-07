import { describe, expect, it, beforeEach } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * TEAM / TRADE UI — EVERY REJECTION IS PROVABLE SERVER-SIDE.
 *
 * The slice's client-side checks exist for UX only. This file proves the other
 * half: each write the UI issues is replayed here as a DIRECT database write, as
 * the signed-in PARTICIPANT (SET LOCAL ROLE authenticated + a JWT `sub`, exactly
 * how PostgREST serves a request), with no UI in the loop and no bypass GUC set.
 * What the screen refuses, the database refuses independently.
 *
 * The write SHAPES below are the ones `app/lib/teamMutations.ts` actually uses,
 * which is the point — a test that proved some other shape would prove nothing:
 *   • initial build  — ONE multi-row INSERT into `trades` (all founding buys)
 *   • one trade      — ONE two-row INSERT (the sell + buy PAIR, single txn)
 *   • materialise    — ONE multi-row INSERT into `selections` (whole set)
 *   • captaincy      — two steps whose INTERMEDIATE state is legal (see below)
 *
 * Everything runs inside `asAuthed`, i.e. ONE transaction, so the DEFERRABLE
 * INITIALLY DEFERRED guards (G15 composition, G15 trade limits, Rider-1 captain)
 * fire at COMMIT over the completed set — the faithful "committed as this user"
 * probe.
 *
 * FIXTURE_CONFIG: teamSize 6 = BAT>=2 / WK>=1 / BWL>=2 / AR>=1 (flex 0),
 * cap 1,000,000, tradesPerRound 2. No number below is written by hand — each
 * expectation is derived from the config, so this file also demonstrates the
 * G11 discipline the UI follows.
 */

const SEASON = "00000000-0000-0000-0000-00000000c000";
const RLOCK = "00000000-0000-0000-0000-00000000c001"; // seq 1, lock_at in the PAST
const R1 = "00000000-0000-0000-0000-00000000c002"; // seq 2, open — founding round
const R2 = "00000000-0000-0000-0000-00000000c003"; // seq 3, open — non-founding
const MATCH = "00000000-0000-0000-0000-00000000c004"; // in_progress, for G6
const SC = "00000000-0000-0000-0000-00000000c005";

const OWNER = "00000000-0000-0000-0000-00000000c0a0";
const STRANGER = "00000000-0000-0000-0000-00000000c0a1";
const FT = "00000000-0000-0000-0000-00000000c0b0";

const BAT1 = "00000000-0000-0000-0000-00000000c0d1";
const BAT2 = "00000000-0000-0000-0000-00000000c0d2";
const BATE = "00000000-0000-0000-0000-00000000c0d3"; // BAT, wk_eligible
const WK1 = "00000000-0000-0000-0000-00000000c0d4";
const BWL1 = "00000000-0000-0000-0000-00000000c0d5";
const BWL2 = "00000000-0000-0000-0000-00000000c0d6";
const BWLE = "00000000-0000-0000-0000-00000000c0d7"; // BWL, wk_eligible
const AR1 = "00000000-0000-0000-0000-00000000c0d8";
const AR2 = "00000000-0000-0000-0000-00000000c0d9";
const INMATCH = "00000000-0000-0000-0000-00000000c0da"; // in an in_progress lineup
const RICH1 = "00000000-0000-0000-0000-00000000c0db";
const RICH2 = "00000000-0000-0000-0000-00000000c0dc";

const SQUAD = FIXTURE_CONFIG.squad;
const CHEAP = 50_000;
/** Two of these exceed the cap; one does not. */
const RICH = Math.floor(SQUAD.cap * 0.6);

const player = (
  id: string,
  key: string,
  role: "BAT" | "WK" | "BWL" | "AR",
  wkEligible: boolean,
  price = CHEAP,
) => ({
  id,
  registryKey: key,
  displayName: key,
  role,
  wkEligible,
  startingPrice: price,
  active: true,
});

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      player(BAT1, "bat1", "BAT", false),
      player(BAT2, "bat2", "BAT", false),
      player(BATE, "bate", "BAT", true),
      player(WK1, "wk1", "WK", false),
      player(BWL1, "bwl1", "BWL", false),
      player(BWL2, "bwl2", "BWL", false),
      player(BWLE, "bwle", "BWL", true),
      player(AR1, "ar1", "AR", false),
      player(AR2, "ar2", "AR", false),
      player(INMATCH, "inmatch", "BAT", false),
      player(RICH1, "rich1", "BAT", false, RICH),
      player(RICH2, "rich2", "BAT", false, RICH),
    ],
    rounds: [
      { id: RLOCK, seq: 1, name: "Locked round", lockAt: "2020-01-01T00:00:00Z" },
      { id: R1, seq: 2, name: "R1", lockAt: "2099-01-01T00:00:00Z" },
      { id: R2, seq: 3, name: "R2", lockAt: "2099-01-01T00:00:00Z" },
    ],
    matches: [
      {
        id: MATCH,
        roundId: R1,
        grade: "A",
        opponent: "Opp",
        status: "in_progress",
        finalDayDate: null,
        finalisedAt: null,
      },
    ],
    scorecards: [
      {
        id: SC,
        matchId: MATCH,
        wicketKeeperPlayerId: null,
        reviewState: "committed",
        lineup: [INMATCH],
        batting: [],
        bowling: [],
        dismissals: [],
      },
    ],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "Participant XI" }],
    selections: [],
    trades: [],
  };
}

let db: DbClient;
let seq = 0;
const uid = (tag: string) =>
  `00000000-0000-0000-0000-${tag}${String(seq++).padStart(8, "0")}`;

beforeEach(async () => {
  db = await makeTestDb();
  await seedSeason(db, buildRaw());
  // A second profile so the "someone else's team" probe has a real identity.
  await db.query(
    "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
    [STRANGER, "stranger"],
  );
  seq = 0;
});

/** The UI's selection write: ONE multi-row INSERT of the WHOLE set. */
function insertSelectionSet(
  players: string[],
  roundId: string,
  captain = players[0]!,
  vice: string | null = players[1] ?? null,
  teamId = FT,
) {
  const values = players
    .map(
      (_, i) =>
        `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`,
    )
    .join(",");
  const params = players.flatMap((p) => [
    uid("5e1e"),
    teamId,
    roundId,
    p,
    p === captain,
    p === vice,
  ]);
  return db.query(
    `INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ${values}`,
    params,
  );
}

/** The UI's ledger write: ONE multi-row INSERT of buys and/or sells. */
function insertTrades(
  rows: { kind: "buy" | "sell"; player: string; price?: number }[],
  roundId: string,
  teamId = FT,
) {
  const values = rows
    .map(
      (_, i) =>
        `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`,
    )
    .join(",");
  const params = rows.flatMap((r) => [
    uid("77ad"),
    teamId,
    r.kind,
    r.player,
    r.price ?? CHEAP,
    roundId,
  ]);
  return db.query(
    `INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ${values}`,
    params,
  );
}

const asOwner = <T>(fn: () => Promise<T>) =>
  asAuthed(db, { role: "authenticated", sub: OWNER }, fn);

/** A legal squad under the fixture config: 2 BAT / 1 WK / 2 BWL / 1 AR. */
const LEGAL = [BAT1, BAT2, WK1, BWL1, BWL2, AR1];

describe("selection composition — refused by the database, not the screen (G15)", () => {
  it("a legal squad commits as the participant", async () => {
    await expect(asOwner(() => insertSelectionSet(LEGAL, R1))).resolves.toBeDefined();
    const rows = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM selections WHERE fantasy_team_id = $1 AND round_id = $2",
      [FT, R1],
    );
    expect(Number(rows.rows[0]!.n)).toBe(SQUAD.teamSize);
  });

  it("one short is refused, naming the size constraint", async () => {
    const short = LEGAL.slice(0, SQUAD.teamSize - 1);
    await expect(asOwner(() => insertSelectionSet(short, R1))).rejects.toThrow(
      /team size/i,
    );
  });

  it("one over is refused, naming the size constraint", async () => {
    await expect(
      asOwner(() => insertSelectionSet([...LEGAL, AR2], R1)),
    ).rejects.toThrow(/team size/i);
  });

  it("a role minimum short is refused, naming the role minimum", async () => {
    // 1 BAT where the config demands 2, padded back to teamSize with an AR.
    const shortBat = [BAT1, WK1, BWL1, BWL2, AR1, AR2];
    await expect(asOwner(() => insertSelectionSet(shortBat, R1))).rejects.toThrow(
      /role minimum/i,
    );
  });

  it("the WK minimum satisfied by a wk_eligible NON-WK commits (D9)", async () => {
    // No WK-role player at all: 2 BAT / 3 BWL (one wk_eligible) / 1 AR. The
    // spare BWL is surplus to the BWL minimum, so he may keep wicket.
    const viaEligible = [BAT1, BAT2, BWL1, BWL2, BWLE, AR1];
    await expect(
      asOwner(() => insertSelectionSet(viaEligible, R1)),
    ).resolves.toBeDefined();
  });

  it("STRICT counting: a wk_eligible player needed for his own minimum cannot also keep", async () => {
    // 2 BAT (one wk_eligible, but both are needed to meet BAT>=2), 2 BWL, 2 AR,
    // no WK. A naive count(WK OR wk_eligible) would wrongly pass this.
    const doubleCount = [BAT1, BATE, BWL1, BWL2, AR1, AR2];
    await expect(asOwner(() => insertSelectionSet(doubleCount, R1))).rejects.toThrow(
      /WK minimum/i,
    );
  });

  it("a squad with no captain is refused (Rider 1 / D10)", async () => {
    await expect(
      asOwner(() => insertSelectionSet(LEGAL, R1, "no-such-player")),
    ).rejects.toThrow(/exactly one captain/i);
  });
});

describe("trades — pairs, limits and the founding exemption (G15)", () => {
  it("initial construction of a full squad consumes ZERO trades", async () => {
    // teamSize buys in one go, with tradesPerRound far below that, in the
    // team's founding round: accepted, because founding buys are exempt.
    expect(SQUAD.teamSize).toBeGreaterThan(SQUAD.tradesPerRound);
    await expect(
      asOwner(() => insertTrades(LEGAL.map((p) => ({ kind: "buy" as const, player: p })), R1)),
    ).resolves.toBeDefined();
  });

  it("a sell+buy PAIR commits as one write", async () => {
    await asOwner(() =>
      insertTrades(LEGAL.map((p) => ({ kind: "buy" as const, player: p })), R1),
    );
    await expect(
      asOwner(() =>
        insertTrades(
          [
            { kind: "sell", player: AR1 },
            { kind: "buy", player: AR2 },
          ],
          R2,
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("trades AT the configured limit commit in a non-founding round", async () => {
    await asOwner(() =>
      insertTrades(LEGAL.map((p) => ({ kind: "buy" as const, player: p })), R1),
    );
    const atLimit = [BATE, BWLE].slice(0, SQUAD.tradesPerRound);
    expect(atLimit).toHaveLength(SQUAD.tradesPerRound);
    await expect(
      asOwner(() => insertTrades(atLimit.map((p) => ({ kind: "buy" as const, player: p })), R2)),
    ).resolves.toBeDefined();
  });

  it("one trade OVER the configured limit is refused", async () => {
    await asOwner(() =>
      insertTrades(LEGAL.map((p) => ({ kind: "buy" as const, player: p })), R1),
    );
    const overLimit = [BATE, BWLE, AR2].slice(0, SQUAD.tradesPerRound + 1);
    expect(overLimit).toHaveLength(SQUAD.tradesPerRound + 1);
    await expect(
      asOwner(() => insertTrades(overLimit.map((p) => ({ kind: "buy" as const, player: p })), R2)),
    ).rejects.toThrow(/trades/i);
  });

  it("a purchase over the salary cap is refused", async () => {
    expect(RICH * 2).toBeGreaterThan(SQUAD.cap);
    await expect(
      asOwner(() =>
        insertTrades(
          [
            { kind: "buy", player: RICH1, price: RICH },
            { kind: "buy", player: RICH2, price: RICH },
          ],
          R1,
        ),
      ),
    ).rejects.toThrow(/cap/i);
  });

  it("within the cap the same write commits", async () => {
    await expect(
      asOwner(() => insertTrades([{ kind: "buy", player: RICH1, price: RICH }], R1)),
    ).resolves.toBeDefined();
  });
});

describe("lock states — refused server-side, not merely greyed out", () => {
  it("a team change against a LOCKED round is refused (D6/G4)", async () => {
    await expect(asOwner(() => insertSelectionSet(LEGAL, RLOCK))).rejects.toThrow(
      /is locked/i,
    );
  });

  it("a trade against a LOCKED round is refused (D6/G4)", async () => {
    await expect(
      asOwner(() => insertTrades([{ kind: "buy", player: BAT1 }], RLOCK)),
    ).rejects.toThrow(/is locked/i);
  });

  it("BUYING a player whose match is in progress is refused (D7/G6)", async () => {
    await expect(
      asOwner(() => insertTrades([{ kind: "buy", player: INMATCH }], R1)),
    ).rejects.toThrow(/match in progress/i);
  });

  it("SELLING a player whose match is in progress is refused (D7/G6)", async () => {
    await expect(
      asOwner(() => insertTrades([{ kind: "sell", player: INMATCH }], R1)),
    ).rejects.toThrow(/match in progress/i);
  });

  it("the lock releases once the match is finalised", async () => {
    await db.query("UPDATE matches SET status = 'finalised' WHERE id = $1", [MATCH]);
    await expect(
      asOwner(() => insertTrades([{ kind: "buy", player: INMATCH }], R1)),
    ).resolves.toBeDefined();
  });
});

describe("ownership — the ledger belongs to its owner (G13/RLS)", () => {
  it("a signed-in stranger cannot write to someone else's team", async () => {
    await expect(
      asAuthed(db, { role: "authenticated", sub: STRANGER }, () =>
        insertTrades([{ kind: "buy", player: BAT1 }], R1),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("a signed-in stranger cannot write someone else's selections", async () => {
    await expect(
      asAuthed(db, { role: "authenticated", sub: STRANGER }, () =>
        insertSelectionSet(LEGAL, R1),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });
});

describe("captaincy transitions keep a legal set at every commit (Rider 1 / D10)", () => {
  /**
   * A straight captain↔vice SWAP cannot be one multi-row statement in either
   * order: the partial unique indexes are IMMEDIATE, so whichever row is written
   * first momentarily doubles a flag. The UI therefore writes it in two steps
   * whose intermediate state is legal — new captain with NO vice anywhere
   * (exactly one captain satisfies the deferred guard; a vice is optional) —
   * and only then sets the vice. This proves the sequence commits.
   */
  it("swapping captain and vice-captain commits as two legal steps", async () => {
    await asOwner(() => insertSelectionSet(LEGAL, R1, BAT1, BAT2));

    // Step 1: clear every flag, then set the NEW captain — clearing rows first
    // so the immediate index never sees two captains.
    await asOwner(async () => {
      await db.query(
        "UPDATE selections SET is_captain = false, is_vice_captain = false WHERE fantasy_team_id = $1 AND round_id = $2",
        [FT, R1],
      );
      await db.query(
        "UPDATE selections SET is_captain = true WHERE fantasy_team_id = $1 AND round_id = $2 AND player_id = $3",
        [FT, R1, BAT2],
      );
    });

    // Step 2: the vice.
    await asOwner(() =>
      db.query(
        "UPDATE selections SET is_vice_captain = true WHERE fantasy_team_id = $1 AND round_id = $2 AND player_id = $3",
        [FT, R1, BAT1],
      ),
    );

    const rows = await db.query<{ player_id: string; is_captain: boolean; is_vice_captain: boolean }>(
      "SELECT player_id, is_captain, is_vice_captain FROM selections WHERE fantasy_team_id = $1 AND round_id = $2 AND (is_captain OR is_vice_captain)",
      [FT, R1],
    );
    const captain = rows.rows.find((r) => r.is_captain);
    const vice = rows.rows.find((r) => r.is_vice_captain);
    expect(captain?.player_id).toBe(BAT2);
    expect(vice?.player_id).toBe(BAT1);
  });

  it("clearing the captain WITHOUT naming a new one is refused", async () => {
    await asOwner(() => insertSelectionSet(LEGAL, R1, BAT1, BAT2));
    await expect(
      asOwner(() =>
        db.query(
          "UPDATE selections SET is_captain = false WHERE fantasy_team_id = $1 AND round_id = $2",
          [FT, R1],
        ),
      ),
    ).rejects.toThrow(/exactly one captain/i);
  });
});

describe("emptying the set is legal; deleting PART of it is not", () => {
  it("removing one player from a full squad is refused (the set is judged whole)", async () => {
    await asOwner(() => insertSelectionSet(LEGAL, R1));
    await expect(
      asOwner(() =>
        db.query(
          "DELETE FROM selections WHERE fantasy_team_id = $1 AND round_id = $2 AND player_id = $3",
          [FT, R1, AR1],
        ),
      ),
    ).rejects.toThrow(/team size/i);
  });

  it("deleting the WHOLE set commits — which is what makes repair possible", async () => {
    await asOwner(() => insertSelectionSet(LEGAL, R1));
    await expect(
      asOwner(() =>
        db.query("DELETE FROM selections WHERE fantasy_team_id = $1 AND round_id = $2", [
          FT,
          R1,
        ]),
      ),
    ).resolves.toBeDefined();
  });
});

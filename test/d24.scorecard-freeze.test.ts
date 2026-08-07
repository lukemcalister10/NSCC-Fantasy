import { describe, it, expect, beforeAll } from "vitest";
import { makeTestDb, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";
import { loadRawSeason, writeDerived } from "../src/db/repository.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";

/**
 * D24 SCORECARD FREEZE (DECISION_LOG v1.9).
 *
 * "A round's scorecards are editable until the operator manually ends lockout for
 * that round, then frozen — no corrections after, even for discovered errors" with
 * "a deliberate logged override (who/when/why) for catastrophic cases", enforced
 * SERVER-SIDE, not just in the UI.
 *
 * So every refusal below is proven by a DIRECT database write as an authenticated
 * league manager — the same path a hand-rolled API call would take, with the UI
 * entirely out of the picture.
 *
 * The consequence the ruling names — no retrospective price movement, so purchase
 * prices and cap balances can never be invalidated — follows from the raw truth
 * being immutable once frozen, which is what these tests pin.
 */

const SEASON = "5ea50000-0000-4000-8000-000000240001";
const ROUND = "40110000-0000-4000-8000-000000240001";
const OPEN_ROUND = "40110000-0000-4000-8000-000000240002";
const MATCH = "3a7c0000-0000-4000-8000-000000240001";
const OPEN_MATCH = "3a7c0000-0000-4000-8000-000000240002";
const CARD = "5cad0000-0000-4000-8000-000000240001";
const OPEN_CARD = "5cad0000-0000-4000-8000-000000240002";
const MANAGER = "0000a000-0000-4000-8000-000000240001";
const PARTICIPANT = "0000a000-0000-4000-8000-000000240002";
const PLAYER = "71a70000-0000-4000-8000-000000240001";

const managerCtx = { role: "authenticated", sub: MANAGER } as const;
const participantCtx = { role: "authenticated", sub: PARTICIPANT } as const;

describe("D24 — scorecard freeze, enforced in the database", () => {
  let db: DbClient;

  beforeAll(async () => {
    db = await makeTestDb();
    await db.query("BEGIN");
    await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
      SEASON,
      "freeze season",
      JSON.stringify(FIXTURE_CONFIG),
    ]);
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'The Manager',true), ($2,'A Participant',false)",
      [MANAGER, PARTICIPANT],
    );
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,'Jo Whitlam','Jo Whitlam','BAT',false,60000,true)`,
      [PLAYER, SEASON],
    );
    for (const [id, seq, name] of [
      [ROUND, 1, "Round 1"],
      [OPEN_ROUND, 2, "Round 2"],
    ] as const) {
      await db.query(
        "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,$3,$4,'2099-10-10T00:30:00Z')",
        [id, SEASON, seq, name],
      );
    }
    for (const [id, round] of [
      [MATCH, ROUND],
      [OPEN_MATCH, OPEN_ROUND],
    ] as const) {
      await db.query(
        `INSERT INTO matches (id, round_id, grade, opponent, status, final_day_date, finalised_at)
         VALUES ($1,$2,'A Grade','Invented CC','finalised','2026-10-11','2026-10-11T06:30:00Z')`,
        [id, round],
      );
    }
    for (const [card, match] of [
      [CARD, MATCH],
      [OPEN_CARD, OPEN_MATCH],
    ] as const) {
      await db.query(
        "INSERT INTO scorecards (id, match_id, review_state) VALUES ($1,$2,'committed')",
        [card, match],
      );
      await db.query("INSERT INTO scorecard_lineup (scorecard_id, player_id) VALUES ($1,$2)", [
        card,
        PLAYER,
      ]);
      await db.query(
        `INSERT INTO batting_lines (scorecard_id, innings, player_id, runs, balls_faced, fours, sixes)
         VALUES ($1,1,$2,40,30,5,0)`,
        [card, PLAYER],
      );
    }
    await db.query("COMMIT");
  }, 120_000);

  it("allows ordinary correction while the round is open", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query(
        "UPDATE batting_lines SET runs = 41 WHERE scorecard_id = $1 AND player_id = $2",
        [CARD, PLAYER],
      );
    });
    const { rows } = await db.query<{ runs: number }>(
      "SELECT runs FROM batting_lines WHERE scorecard_id = $1",
      [CARD],
    );
    expect(rows[0]!.runs).toBe(41);
  });

  it("the operator ends lockout for the round, and only for that round", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query("UPDATE rounds SET scorecards_frozen_at = now() WHERE id = $1", [ROUND]);
    });
    const { rows } = await db.query<{ id: string; frozen: string | null }>(
      "SELECT id, scorecards_frozen_at AS frozen FROM rounds WHERE season_id = $1 ORDER BY seq",
      [SEASON],
    );
    expect(rows[0]!.frozen).not.toBeNull();
    expect(rows[1]!.frozen).toBeNull();
  });

  it("refuses every scorecard write under the frozen round — as the league manager, direct to the database", async () => {
    const attempts: [string, () => Promise<unknown>][] = [
      [
        "correct a batting line",
        () =>
          db.query("UPDATE batting_lines SET runs = 999 WHERE scorecard_id = $1", [CARD]),
      ],
      [
        "add a bowling line",
        () =>
          db.query(
            "INSERT INTO bowling_lines (scorecard_id, innings, player_id, overs, runs_conceded, wickets) VALUES ($1,1,$2,4,20,1)",
            [CARD, PLAYER],
          ),
      ],
      [
        "add a dismissal",
        () =>
          db.query(
            "INSERT INTO dismissals (scorecard_id, innings, seq, resolved_text) VALUES ($1,1,0,$2)",
            [CARD, `c ${PLAYER} b ${PLAYER}`],
          ),
      ],
      [
        "drop a player from the lineup",
        () =>
          db.query("DELETE FROM scorecard_lineup WHERE scorecard_id = $1", [CARD]),
      ],
      [
        "abandon the match (which would erase its scores, D19)",
        () => db.query("UPDATE matches SET status = 'abandoned' WHERE id = $1", [MATCH]),
      ],
      [
        "add another match to the round",
        () =>
          db.query(
            "INSERT INTO matches (round_id, grade, opponent, status) VALUES ($1,'B Grade','Invented CC','scheduled')",
            [ROUND],
          ),
      ],
    ];

    for (const [what, attempt] of attempts) {
      await expect(
        asAuthed(db, managerCtx, attempt),
        `expected refusal: ${what}`,
      ).rejects.toThrow(/frozen/);
    }

    // The open round is untouched by any of it.
    await asAuthed(db, managerCtx, async () => {
      await db.query("UPDATE batting_lines SET runs = 55 WHERE scorecard_id = $1", [OPEN_CARD]);
    });
    const { rows } = await db.query<{ runs: number }>(
      "SELECT runs FROM batting_lines WHERE scorecard_id = $1",
      [OPEN_CARD],
    );
    expect(rows[0]!.runs).toBe(55);
  });

  it("the freeze mark is one-way: it cannot be cleared or moved", async () => {
    await expect(
      asAuthed(db, managerCtx, () =>
        db.query("UPDATE rounds SET scorecards_frozen_at = NULL WHERE id = $1", [ROUND]),
      ),
    ).rejects.toThrow(/cannot be cleared or moved/);

    await expect(
      asAuthed(db, managerCtx, () =>
        db.query(
          "UPDATE rounds SET scorecards_frozen_at = '2020-01-01T00:00:00Z' WHERE id = $1",
          [ROUND],
        ),
      ),
    ).rejects.toThrow(/cannot be cleared or moved/);
  });

  it("a deliberate override with a stated reason succeeds AND is logged (who/when/why)", async () => {
    await asAuthed(db, managerCtx, async () => {
      await db.query("SELECT set_config('app.scorecard_override_reason', $1, true)", [
        "Grade B card was entered against the wrong match; corrected on club advice 12/11",
      ]);
      await db.query(
        "UPDATE batting_lines SET runs = 77 WHERE scorecard_id = $1 AND player_id = $2",
        [CARD, PLAYER],
      );
    });

    const { rows } = await db.query<{ runs: number }>(
      "SELECT runs FROM batting_lines WHERE scorecard_id = $1",
      [CARD],
    );
    expect(rows[0]!.runs).toBe(77);

    const log = await db.query<{
      round_id: string;
      table_name: string;
      operation: string;
      actor: string;
      reason: string;
      at: string;
    }>("SELECT round_id, table_name, operation, actor, reason, at FROM scorecard_override_log");
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]!.round_id).toBe(ROUND);
    expect(log.rows[0]!.table_name).toBe("batting_lines");
    expect(log.rows[0]!.operation).toBe("UPDATE");
    expect(log.rows[0]!.actor).toBe(MANAGER); // WHO
    expect(log.rows[0]!.at).toBeTruthy(); // WHEN
    expect(log.rows[0]!.reason).toContain("wrong match"); // WHY
  });

  it("the override does not linger: the next transaction is frozen again", async () => {
    await expect(
      asAuthed(db, managerCtx, () =>
        db.query("UPDATE batting_lines SET runs = 1 WHERE scorecard_id = $1", [CARD]),
      ),
    ).rejects.toThrow(/frozen/);
  });

  it("an empty or whitespace reason is not a reason", async () => {
    await expect(
      asAuthed(db, managerCtx, async () => {
        await db.query("SELECT set_config('app.scorecard_override_reason', '   ', true)");
        await db.query("UPDATE batting_lines SET runs = 2 WHERE scorecard_id = $1", [CARD]);
      }),
    ).rejects.toThrow(/frozen/);
  });

  it("a participant gets nowhere, override reason or not", async () => {
    await expect(
      asAuthed(db, participantCtx, async () => {
        await db.query("SELECT set_config('app.scorecard_override_reason', 'let me in', true)");
        await db.query(
          "INSERT INTO dismissals (scorecard_id, innings, seq, resolved_text) VALUES ($1,1,9,'x')",
          [CARD],
        );
      }),
    ).rejects.toThrow();
  });

  it("does NOT block recompute — derived state is still rewritten wholesale (D15/G3)", async () => {
    // The freeze bars edits to RAW truth. Recompute rewrites DERIVED state, and a
    // frozen round simply always recomputes to the same answer. If this ever
    // failed, D24 would have broken the prime invariant instead of protecting it.
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    await expect(writeDerived(db, SEASON, derived)).resolves.toBeUndefined();
    const again = recomputeSeason(await loadRawSeason(db, SEASON));
    expect(again).toEqual(derived);
  });
});

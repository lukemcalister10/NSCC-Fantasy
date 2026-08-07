import type { DbClient } from "./repository.js";
import { loadRawSeason, readDerived, writeDerived } from "./repository.js";
import { recomputeSeason } from "../recompute/orchestrator.js";
import type { DerivedState } from "../recompute/types.js";

/**
 * RECOMPUTE RUNNER — the one entry point the manager control, the CLI and the
 * serverless route all call. It ORCHESTRATES the existing verified path
 * (loadRawSeason -> recomputeSeason -> writeDerived) and adds nothing to it: no
 * scoring, no pricing, no partial rebuild. G3 idempotence is already VERIFIED;
 * this exposes it, it does not re-earn it.
 *
 * WHY THERE IS NO "RECOMPUTE ROUND N" (D24-era note, operator-approved):
 * `recomputeSeason` is a whole-season function by construction — prices are a
 * chain (each movement reads the price the previous match left), so no round can
 * be rebuilt in isolation without re-deriving everything after it. Writing a
 * round-scoped engine entry point would be a FORK of the recompute path, which
 * this slice may not do. So the control runs the full season pass and is LABELLED
 * as running the full season pass; what it scopes to a round is the SUMMARY of
 * what changed. Nothing here is ever presented as "recompute round N".
 *
 * The summary is a diff of derived state before and after, so an operator who
 * presses the button after correcting one scorecard can see exactly which round,
 * which teams and how many prices moved — rather than trusting a green tick.
 */

export interface TeamScoreChange {
  fantasyTeamId: string;
  before: number | null;
  after: number | null;
}

export interface RoundChange {
  roundId: string;
  name: string;
  seq: number;
  teamScores: TeamScoreChange[];
}

export interface RecomputeSummary {
  seasonId: string;
  /** True when any derived family differs from what was stored before the run. */
  changed: boolean;
  /** Derived families that differ, by name — the blast radius, plainly. */
  changedFamilies: string[];
  /** Per-round detail, only for rounds whose team scores moved. */
  rounds: RoundChange[];
  /** Count of price points that differ (added, removed or repriced). */
  priceMovementsChanged: number;
  /** Row counts written, so an empty recompute is visibly empty. */
  written: Record<string, number>;
}

const FAMILIES = [
  "playerMatchScores",
  "priceHistory",
  "teamCapSnapshots",
  "teamRoundScores",
  "h2hResults",
  "ladder",
  "overallLeaderboard",
] as const;

/** Stable JSON for order-insensitive family comparison (arrays are already
 *  deterministically ordered by the orchestrator and by readDerived). */
const key = (v: unknown): string => JSON.stringify(v);

export async function runRecompute(
  db: DbClient,
  seasonId: string,
): Promise<RecomputeSummary> {
  const before = await readDerived(db, seasonId);
  const raw = await loadRawSeason(db, seasonId);
  const after = recomputeSeason(raw);
  await writeDerived(db, seasonId, after);

  const changedFamilies = FAMILIES.filter(
    (f) => key(before[f as keyof DerivedState]) !== key(after[f as keyof DerivedState]),
  );

  // Price points that differ, keyed on (player, seq) so a repriced movement, a new
  // one and a vanished one all count once.
  const priceKey = (p: { playerId: string; seq: number }) => `${p.playerId}#${p.seq}`;
  const beforePrices = new Map(before.priceHistory.map((p) => [priceKey(p), p.price]));
  const afterPrices = new Map(after.priceHistory.map((p) => [priceKey(p), p.price]));
  let priceMovementsChanged = 0;
  for (const [k, v] of afterPrices) if (beforePrices.get(k) !== v) priceMovementsChanged++;
  for (const k of beforePrices.keys()) if (!afterPrices.has(k)) priceMovementsChanged++;

  // Round-scoped summary: which rounds' team totals moved, and by how much.
  const roundName = new Map(raw.rounds.map((r) => [r.id, { name: r.name, seq: r.seq }]));
  const scoreKey = (t: { fantasyTeamId: string; roundId: string }) =>
    `${t.roundId}#${t.fantasyTeamId}`;
  const beforeScores = new Map(before.teamRoundScores.map((t) => [scoreKey(t), t.total]));
  const afterScores = new Map(after.teamRoundScores.map((t) => [scoreKey(t), t.total]));

  const byRound = new Map<string, TeamScoreChange[]>();
  const noteChange = (roundId: string, change: TeamScoreChange) => {
    const list = byRound.get(roundId) ?? [];
    list.push(change);
    byRound.set(roundId, list);
  };
  for (const t of after.teamRoundScores) {
    const wasScore = beforeScores.get(scoreKey(t));
    if (wasScore !== t.total) {
      noteChange(t.roundId, {
        fantasyTeamId: t.fantasyTeamId,
        before: wasScore ?? null,
        after: t.total,
      });
    }
  }
  for (const t of before.teamRoundScores) {
    if (!afterScores.has(scoreKey(t))) {
      noteChange(t.roundId, {
        fantasyTeamId: t.fantasyTeamId,
        before: t.total,
        after: null,
      });
    }
  }

  const rounds: RoundChange[] = [...byRound.entries()]
    .map(([roundId, teamScores]) => ({
      roundId,
      name: roundName.get(roundId)?.name ?? "(unknown round)",
      seq: roundName.get(roundId)?.seq ?? 0,
      teamScores: teamScores.sort((a, b) => a.fantasyTeamId.localeCompare(b.fantasyTeamId)),
    }))
    .sort((a, b) => a.seq - b.seq);

  return {
    seasonId,
    changed: changedFamilies.length > 0,
    changedFamilies: [...changedFamilies],
    rounds,
    priceMovementsChanged,
    written: Object.fromEntries(
      FAMILIES.map((f) => [f, (after[f as keyof DerivedState] as unknown[]).length]),
    ),
  };
}

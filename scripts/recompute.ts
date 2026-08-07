/**
 * RECOMPUTE CLI (operator, server-side).
 *
 *   POSTGRES_URL='…' npm run recompute -- --season <season-uuid>
 *   POSTGRES_URL='…' npm run recompute -- --latest        # most recent season
 *   POSTGRES_URL='…' npm run recompute -- --latest --dry-run
 *
 * Same runner the manager's button calls (src/db/runRecompute.ts), so the two can
 * never drift: one full-season pass over the existing verified path, then a
 * round-scoped summary of what actually changed.
 *
 * This exists as well as the button because it needs nothing but a connection
 * string — no deployment, no hosting configuration — so a recompute is always
 * available to the operator even when the serverless route is not configured.
 *
 * --dry-run recomputes and reports the diff WITHOUT writing, by rolling the
 * transaction back: useful before touching a live season.
 *
 * The connection string comes from the environment only. It is never read from a
 * file in this repository and never printed.
 */
import { withPgClient } from "../src/db/pgClient.js";
import { runRecompute } from "../src/db/runRecompute.js";
import type { DbClient } from "../src/db/repository.js";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? null);
};
const has = (name: string): boolean => args.includes(`--${name}`);

async function main(): Promise<void> {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    fail(
      "POSTGRES_URL is not set. Provide the database connection string in the environment; it is never stored in this repository.",
    );
  }

  const explicitSeason = flag("season");
  if (!explicitSeason && !has("latest")) {
    fail("usage: npm run recompute -- (--season <uuid> | --latest) [--dry-run]");
  }

  const dryRun = has("dry-run");

  await withPgClient(connectionString!, async (db) => {
    const seasonId = explicitSeason ?? (await latestSeason(db));
    const name = await seasonName(db, seasonId);

    console.log(`Season: ${name} (${seasonId})`);
    console.log(
      dryRun
        ? "Mode:   DRY RUN — recomputing and rolling back; nothing is written"
        : "Mode:   full-season recompute (there is no partial pass — prices are a chain)",
    );

    if (dryRun) await db.query("BEGIN");
    const summary = await runRecompute(db, seasonId);
    if (dryRun) await db.query("ROLLBACK");

    if (!summary.changed) {
      console.log("\nNo derived state changed. (Recompute is idempotent — G3.)");
    } else {
      console.log(`\nChanged: ${summary.changedFamilies.join(", ")}`);
      console.log(`Price movements changed: ${summary.priceMovementsChanged}`);
      for (const round of summary.rounds) {
        console.log(`\n  ${round.name} (round ${round.seq})`);
        for (const t of round.teamScores) {
          console.log(
            `    team ${t.fantasyTeamId}: ${t.before ?? "—"} → ${t.after ?? "—"}`,
          );
        }
      }
    }
    console.log(
      `\nRows ${dryRun ? "that would be written" : "written"}: ` +
        Object.entries(summary.written)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · "),
    );
  });
}

async function latestSeason(db: DbClient): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM seasons ORDER BY created_at DESC LIMIT 1",
  );
  if (!rows[0]) fail("no seasons exist in this database");
  return rows[0]!.id;
}

async function seasonName(db: DbClient, id: string): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    "SELECT name FROM seasons WHERE id = $1",
    [id],
  );
  if (!rows[0]) fail(`season ${id} not found`);
  return rows[0]!.name;
}

function fail(message: string): never {
  console.error(`recompute: ${message}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  // A failed recompute (e.g. the Rider-2 price-integrity assert) must be loud.
  // writeDerived is transactional, so the previous derived state is intact.
  console.error(`recompute failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

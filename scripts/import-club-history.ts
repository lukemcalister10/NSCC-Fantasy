import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ClubPlayer {
  id: string;
  name: string;
}

interface ClubSeason {
  season: string;
  teamName: string;
  grade: string;
  association: string;
  matches: number;
  innings: number;
  notOuts: number;
  runs: number;
  highScore: number;
  battingAverage: number | null;
  strikeRate: number | null;
  overs: string | null;
  wickets: number;
  bestBowling: string | null;
  bowlingAverage: number | null;
  economy: number | null;
  catches: number;
  stumpings: number;
}

interface ClubProfile extends ClubPlayer {
  seasons: ClubSeason[];
}

const baseUrl = "https://www.northshorecc.org.au/_functions";
const apiKey = process.env.CLUB_API_KEY;
if (!apiKey) throw new Error("Set CLUB_API_KEY before running this importer.");

// These returning 2026/27 players have complete public profiles but are marked
// inactive in the club directory, so /players omits them. Their stable profile
// ids still work with the read-only /player endpoint.
const rosterOverrides: ClubPlayer[] = [
  { id: "8d73c6e9-086c-4c34-b8b5-adf4fa2a2a41", name: "Amit Purbi" },
  { id: "eed61074-054b-4918-b2a1-d932aeb4ade0", name: "Andrew Castellano" },
  { id: "1f406f67-d284-43ec-b778-eecb4e872433", name: "Ralph Amerasinghe" },
];

function normalise(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-app-key": apiKey! },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return (await response.json()) as T;
}

function compactSeason(season: ClubSeason): ClubSeason {
  return {
    season: season.season,
    teamName: season.teamName,
    grade: season.grade,
    association: season.association,
    matches: season.matches,
    innings: season.innings,
    notOuts: season.notOuts,
    runs: season.runs,
    highScore: season.highScore,
    battingAverage: season.battingAverage,
    strikeRate: season.strikeRate,
    overs: season.overs,
    wickets: season.wickets,
    bestBowling: season.bestBowling,
    bowlingAverage: season.bowlingAverage,
    economy: season.economy,
    catches: season.catches,
    stumpings: season.stumpings,
  };
}

const csv = await readFile(resolve("data/nscc_registry_seed_2627.csv"), "utf8");
const registryNames = csv
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => line.split(",", 1)[0]!.trim());

const roster = await getJson<ClubPlayer[]>("/players");
const rosterByName = new Map(
  [...roster, ...rosterOverrides].map((player) => [normalise(player.name), player]),
);
const imported: Record<string, { clubPlayerId: string; clubName: string; seasons: ClubSeason[] }> = {};
const unmatched: string[] = [];

for (const registryName of registryNames) {
  const clubPlayer = rosterByName.get(normalise(registryName));
  if (!clubPlayer) {
    unmatched.push(registryName);
    continue;
  }
  const profile = await getJson<ClubProfile[]>(`/player?id=${encodeURIComponent(clubPlayer.id)}`);
  const seasons = (profile[0]?.seasons ?? [])
    .filter((season) => season.season === "2025/26")
    .map(compactSeason);
  if (seasons.length === 0) {
    unmatched.push(registryName);
    continue;
  }
  imported[registryName] = {
    clubPlayerId: clubPlayer.id,
    clubName: clubPlayer.name,
    seasons,
  };
}

const output = resolve("app/data/previousSeason2526.json");
await mkdir(resolve("app/data"), { recursive: true });
await writeFile(output, `${JSON.stringify(imported, null, 2)}\n`, "utf8");
console.log(`Imported ${Object.keys(imported).length} players to ${output}`);
console.log(`No exact verified match: ${unmatched.join(", ")}`);

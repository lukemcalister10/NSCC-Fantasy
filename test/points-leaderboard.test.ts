import { describe, expect, it } from "vitest";
import { completedLeaderboardRounds, rankPointsLeaderboard, selectedLeaderboardRound, type LeaderboardRound } from "../app/lib/pointsLeaderboard";

const round = (seq: number, frozen: boolean, statuses: string[]): LeaderboardRound => ({
  id: `r${seq}`, seq, name: `Round ${seq}`, scorecards_frozen_at: frozen ? "2026-10-14" : null,
  matches: statuses.map(status => ({ status })),
});

describe("round points leaderboard", () => {
  it("offers only completed published rounds, newest first, including washouts", () => {
    const rounds = [round(1,true,["finalised"]),round(2,true,["abandoned"]),round(3,true,["finalised","abandoned"]),round(4,false,["finalised"]),round(5,true,["scheduled"]),round(6,true,[])];
    expect(completedLeaderboardRounds(rounds).map(r => r.id)).toEqual(["r3","r2","r1"]);
    expect(rounds[0]!.id).toBe("r1");
  });
  it("defaults to latest completed round and safely rejects an unknown or future round", () => {
    const rounds = completedLeaderboardRounds([round(1,true,["finalised"]),round(3,true,["finalised"])]);
    expect(selectedLeaderboardRound(rounds,null)?.id).toBe("r3");
    expect(selectedLeaderboardRound(rounds,"r1")?.id).toBe("r1");
    expect(selectedLeaderboardRound(rounds,"r4")?.id).toBe("r3");
    expect(selectedLeaderboardRound([],"r1")).toBeUndefined();
  });
  it("ranks only the supplied totals, with shared ranks and stable ties", () => {
    const rows = [
      {fantasy_team_id:"b",fantasy_teams:{name:"Beta"},total_points:60},
      {fantasy_team_id:"a",fantasy_teams:{name:"Alpha"},total_points:60},
      {fantasy_team_id:"c",fantasy_teams:{name:"Charlie"},total_points:0},
      {fantasy_team_id:"d",fantasy_teams:null,total_points:-5},
    ];
    expect(rankPointsLeaderboard(rows).map(r => [r.fantasy_team_id,r.rank])).toEqual([["a",1],["b",1],["c",3],["d",4]]);
    expect(rows[0]!.fantasy_team_id).toBe("b");
  });
  it("does not carry season totals or another round into the round ranking", () => {
    const row = (id:string,score:number) => ({fantasy_team_id:id,fantasy_teams:{name:id},total_points:score});
    expect(rankPointsLeaderboard([row("season-leader",1000),row("round-winner",900)])[0]!.fantasy_team_id).toBe("season-leader");
    expect(rankPointsLeaderboard([row("season-leader",100),row("round-winner",400)])[0]!.fantasy_team_id).toBe("round-winner");
  });
});

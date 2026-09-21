import { useMemo, useState } from "react";
import { useLadder, useTeamValues, type LadderRow } from "../lib/queries";
import { money } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "./states";

type SortKey = "name" | "played" | "wins" | "losses" | "ties" | "points_for" | "ladder_points" | "team_value";
type LadderWithValue = LadderRow & { team_value: number | null };

const columns: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: "name", label: "Team", numeric: false },
  { key: "played", label: "P", numeric: true, title: "Played" },
  { key: "wins", label: "W", numeric: true, title: "Wins" },
  { key: "losses", label: "L", numeric: true, title: "Losses" },
  { key: "ties", label: "T", numeric: true, title: "Ties" },
  { key: "points_for", label: "PF", numeric: true, title: "Fantasy points scored; tiebreaker" },
  { key: "ladder_points", label: "Pts", numeric: true, title: "Premiership points" },
  { key: "team_value", label: "Team value", numeric: true, title: "Current player value plus spare cap" },
];

export function SortableLadder({ seasonId }: { seasonId: string | undefined }) {
  const ladder = useLadder(seasonId);
  const teamIds = useMemo(() => (ladder.data ?? []).map((row) => row.fantasy_team_id), [ladder.data]);
  const values = useTeamValues(teamIds);
  const [sort, setSort] = useState<SortKey>("wins");
  const [descending, setDescending] = useState(true);

  const rows = useMemo(() => {
    const byId = new Map(values.data?.map((value) => [value.fantasy_team_id, value.team_value]));
    const withValues: LadderWithValue[] = (ladder.data ?? []).map((row) => ({
      ...row,
      team_value: byId.get(row.fantasy_team_id) ?? null,
    }));
    return withValues.sort((a, b) => {
      const aValue = sort === "name" ? a.fantasy_teams?.name ?? "" : a[sort];
      const bValue = sort === "name" ? b.fantasy_teams?.name ?? "" : b[sort];
      // Missing values stay last in either direction.
      if (aValue === null) return bValue === null ? 0 : 1;
      if (bValue === null) return -1;
      const primary = typeof aValue === "string"
        ? aValue.localeCompare(bValue as string)
        : aValue - (bValue as number);
      if (primary !== 0) return primary * (descending ? -1 : 1);
      return b.wins - a.wins || b.points_for - a.points_for ||
        (a.fantasy_teams?.name ?? "").localeCompare(b.fantasy_teams?.name ?? "");
    });
  }, [ladder.data, values.data, sort, descending]);

  function changeSort(key: SortKey) {
    if (key === sort) setDescending((current) => !current);
    else {
      setSort(key);
      setDescending(key !== "name");
    }
  }

  if (ladder.isLoading || (teamIds.length > 0 && values.isLoading)) return <Loading />;
  if (ladder.error) return <ErrorState error={ladder.error} />;
  if (values.error) return <ErrorState error={values.error} />;
  if (!rows.length) return <EmptyState>No rounds have been scored yet.</EmptyState>;

  return (
    <div className="card table-card">
      <table className="table ladder-table sortable-ladder">
        <thead><tr>
          <th className="col-rank">#</th>
          {columns.map(({ key, label, numeric, title }) => (
            <th key={key} className={numeric ? "col-num" : undefined} aria-sort={sort === key ? descending ? "descending" : "ascending" : "none"}>
              <button type="button" className="ladder-sort" title={title} onClick={() => changeSort(key)}>
                {label}<span aria-hidden="true">{sort === key ? descending ? " ↓" : " ↑" : " ↕"}</span>
              </button>
            </th>
          ))}
        </tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={row.fantasy_team_id}>
            <td className="col-rank num">{index + 1}</td>
            <td className="team-name">{row.fantasy_teams?.name ?? "—"}</td>
            <td className="col-num num">{row.played}</td>
            <td className="col-num num">{row.wins}</td>
            <td className="col-num num">{row.losses}</td>
            <td className="col-num num">{row.ties}</td>
            <td className="col-num num">{row.points_for}</td>
            <td className="col-num num col-pts"><span className="score-chip">{row.ladder_points}</span></td>
            <td className="col-num num">{money(row.team_value)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="table-foot-note">Sorted by wins, then fantasy points scored (PF). Team value = current player value + spare cap. Click a heading to sort.</p>
    </div>
  );
}

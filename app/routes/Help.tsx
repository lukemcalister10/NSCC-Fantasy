import { ErrorState, Loading } from "../components/states";
import { money } from "../lib/format";
import { useSeason } from "../lib/queries";
import { useLeagueConfig } from "../lib/teamQueries";
import type { ScoringConfig } from "../../src/config/types";

function points(value: number) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

function ScoreGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, number]>;
}) {
  const visible = rows.filter(([, value]) => value !== 0);
  if (!visible.length) return null;
  return (
    <section className="help-score-group">
      <h3>{title}</h3>
      <dl>
        {visible.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="num">{points(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Scoring({ scoring }: { scoring: ScoringConfig }) {
  return (
    <>
      <div className="help-score-grid">
        <ScoreGroup
          title="Batting"
          rows={[
            ["Run", scoring.perRun],
            ["Four bonus", scoring.perFour],
            ["Six bonus", scoring.perSix],
            ["50 bonus", scoring.perFifty],
            ["100 bonus (replaces 50)", scoring.perCentury],
            ["Duck", scoring.perDuck],
            ["Not out", scoring.perNotOut],
          ]}
        />
        <ScoreGroup
          title="Bowling"
          rows={[
            ["Wicket", scoring.perWicket],
            ["Maiden over", scoring.perMaiden],
            ["Five wicket innings", scoring.perFiveWicketHaul],
          ]}
        />
        <ScoreGroup
          title="Fielding"
          rows={[
            ["Catch", scoring.perCatch],
            ["Wicketkeeper catch", scoring.perKeeperCatch],
            ["Stumping", scoring.perStumping],
            ["Unassisted run out", scoring.perRunOutUnassisted],
            ["Assisted run out (each fielder)", scoring.perRunOutAssisted],
          ]}
        />
      </div>

      <div className="help-note-list">
        {scoring.econBonusPerNetBall !== 0 ? (
          <p>
            <strong>Economy bonus:</strong> bowlers earn bonus points for conceding fewer than one run per ball. For every four runs below that mark, they earn 1 point, calculated separately for each innings and rounded down. There is no penalty for conceding more than one run per ball.
          </p>
        ) : null}
        {scoring.srBonusPoints !== 0 ? (
          <p>
            <strong>Strike-rate bonus:</strong> {points(scoring.srBonusPoints)} for a strike rate of at least{" "}
            {scoring.srBonusMinStrikeRate} after facing at least {scoring.srBonusMinBalls} balls.
          </p>
        ) : null}
        {scoring.econBonusPoints !== 0 ? (
          <p>
            <strong>Economy bonus:</strong> {points(scoring.econBonusPoints)} for an economy rate of{" "}
            {scoring.econBonusMaxEconomy} or better after at least {scoring.econBonusMinOvers} overs.
          </p>
        ) : null}
        {scoring.secondInningsMultiplier !== 1 ? (
          <p>
            <strong>Second innings:</strong> points earned in a player&apos;s team&apos;s second innings count for {" "}
            {scoring.secondInningsMultiplier}.
          </p>
        ) : null}
      </div>
    </>
  );
}

export function Help() {
  const season = useSeason();
  const config = useLeagueConfig(season.data?.id);

  if (season.isLoading || config.isLoading) return <Loading />;
  if (season.error || config.error) return <ErrorState error={season.error ?? config.error} />;
  if (!config.data) return <ErrorState error={new Error("League settings are not available.")} />;

  const { scoring, pricing, squad } = config.data;
  const minimumTotal = Object.values(squad.roleMinimums).reduce((sum, count) => sum + count, 0);
  const flex = squad.teamSize - minimumTotal;
  const oldWeight = Math.round((1 - pricing.alpha) * 100);
  const newWeight = Math.round(pricing.alpha * 100);

  return (
    <div className="page help-page">
      <h1 className="page-title">Help &amp; FAQ</h1>
      <p className="page-sub">The quick guide to playing NSCC Fantasy.</p>

      <details className="card help-card" open>
        <summary>How are points scored?</summary>
        <div className="help-card-body">
          <p>Points are calculated from each player&apos;s match scorecard.</p>
          <Scoring scoring={scoring} />
        </div>
      </details>

      <details className="card help-card">
        <summary>How do I build my squad?</summary>
        <div className="help-card-body">
          <p>
            Pick {squad.teamSize} players without exceeding the {money(squad.cap)} salary cap. Your squad must include
            at least {squad.roleMinimums.BAT} batter{ squad.roleMinimums.BAT === 1 ? "" : "s" },{" "}
            {squad.roleMinimums.WK} wicketkeeper{ squad.roleMinimums.WK === 1 ? "" : "s" },{" "}
            {squad.roleMinimums.AR} all-rounder{ squad.roleMinimums.AR === 1 ? "" : "s" }, and{" "}
            {squad.roleMinimums.BWL} bowler{ squad.roleMinimums.BWL === 1 ? "" : "s" }.
          </p>
          {flex > 0 ? <p>The remaining {flex} spot{flex === 1 ? " is a flex position" : "s are flex positions"} and can be filled by any role.</p> : null}
          <p>A player marked as wicketkeeper-eligible can fill the wicketkeeper requirement.</p>
        </div>
      </details>

      <details className="card help-card">
        <summary>How do captains work?</summary>
        <div className="help-card-body">
          <p>Your captain scores double. If the captain does not play, the vice-captain scores double instead. If neither plays, nobody receives double points.</p>
          <p>Your selections carry into the next round unless you change them.</p>
        </div>
      </details>

      <details className="card help-card">
        <summary>How do trades work?</summary>
        <div className="help-card-body">
          <p>You receive {squad.tradesPerRound} trade{squad.tradesPerRound === 1 ? "" : "s"} per round. A trade sells one player and buys one eligible replacement while keeping your squad valid and under the salary cap.</p>
          <p>Building your initial squad does not use trades. Once a player&apos;s club match is in progress, that player cannot be traded until the match is finalised.</p>
        </div>
      </details>

      <details className="card help-card">
        <summary>How are player prices set?</summary>
        <div className="help-card-body">
          <p>Starting prices are based on last season&apos;s average fantasy score. Players with fewer than {pricing.startingPriceGamesCap} games are moved proportionally towards the {money(pricing.floor)} minimum price.</p>
          <p>After a player plays, their new price combines {oldWeight}% of their previous price with {newWeight}% of their latest match value at {money(pricing.dollarsPerPoint)} per point. Prices are rounded to the nearest {money(pricing.roundingIncrement)} and never fall below {money(pricing.floor)}.</p>
          <p>If a player does not play, their price does not change.</p>
        </div>
      </details>

      <details className="card help-card">
        <summary>What happens when my fantasy team has a bye?</summary>
        <div className="help-card-body">
          <p>Your team still plays: its score is compared with the median team score for that round, producing a win, loss or tie on the ladder.</p>
        </div>
      </details>

      <details className="card help-card">
        <summary>When does my team lock?</summary>
        <div className="help-card-body">
          <p>The lock time is shown for each round. Squad changes, trades and captain changes must be completed before that time.</p>
        </div>
      </details>
    </div>
  );
}

import { Link, useLocation } from "react-router-dom";
import type { PlayerRole } from "../../../src/config/types";
import type { PlayerAvailabilityStatus } from "../../lib/playerAvailability";
import { money } from "../../lib/format";
import { PlayerAvatar } from "../PlayerAvatar";
import { PlayerAvailabilityDot } from "../PlayerAvailabilityDot";

export interface FieldPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  photoUrl: string | null;
  price: number | null;
  captain: boolean;
  viceCaptain: boolean;
  availability?: PlayerAvailabilityStatus | undefined;
}

const fieldOrder: Record<PlayerRole, number> = { BWL: 0, AR: 1, WK: 2, BAT: 3 };

export function TeamField({ players, onSetCaptain, onSetViceCaptain, disabledReason }: {
  players: FieldPlayer[];
  onSetCaptain?: (playerId: string) => void;
  onSetViceCaptain?: (playerId: string) => void;
  disabledReason?: string | null;
}) {
  const location = useLocation();
  const sorted = [...players].sort((a, b) =>
    fieldOrder[a.role] - fieldOrder[b.role] || (b.price ?? 0) - (a.price ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className="team-field-wrap">
      <div className="team-field" aria-label="Cricket field squad view">
        <div className="team-field-oval" aria-hidden="true" />
        <div className="team-field-pitch" aria-hidden="true" />
        <div className="team-field-players">
          {sorted.map((player) => <div className="team-field-card" key={player.id}>
            <Link to={`/players/${player.id}`} state={{ backgroundLocation: location }} className="team-field-player-link">
              <PlayerAvatar name={player.name} size={64} photoUrl={player.photoUrl} />
              <span className="team-field-player-name">{player.name}<PlayerAvailabilityDot status={player.availability} /></span>
            </Link>
            <span className="team-field-meta"><strong>{player.role}</strong><span className="num">{money(player.price)}</span></span>
            {onSetCaptain && onSetViceCaptain ? (
              <div className="captain-selector team-field-captain" role="group" aria-label={`Captaincy for ${player.name}`}>
                <button type="button" className={`captain-choice${player.captain ? " captain-choice-active" : ""}`}
                  aria-pressed={player.captain} disabled={!!disabledReason} onClick={() => onSetCaptain(player.id)}>CAPT</button>
                <button type="button" className={`captain-choice${player.viceCaptain ? " captain-choice-active" : ""}`}
                  aria-pressed={player.viceCaptain} disabled={!!disabledReason || player.captain} onClick={() => onSetViceCaptain(player.id)}>VICE</button>
              </div>
            ) : player.captain || player.viceCaptain ? (
              <span className="team-field-captain-label">{player.captain ? "Captain" : "Vice-captain"}</span>
            ) : null}
          </div>)}
        </div>
      </div>
      {disabledReason && onSetCaptain ? <p className="table-foot-note">{disabledReason}</p> : null}
    </div>
  );
}

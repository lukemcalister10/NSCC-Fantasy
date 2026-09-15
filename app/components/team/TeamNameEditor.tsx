import { useState } from "react";
import { renameTeam, translateRefusal, type Refusal } from "../../lib/teamMutations";
import { RefusalNotice } from "./TeamChrome";

/**
 * TEAM RENAME (item 4) — the control that makes `RegisterTeam`'s promise true.
 *
 * Registration has always told participants the name "can be changed later", and
 * until now there was no control anywhere that changed it. This builds to the
 * permission that ALREADY EXISTS in 0004 and adds no migration: the
 * `fantasy_teams_update` policy admits the owner, and
 * `app.enforce_fantasy_team_participant_update` refuses owner_profile_id and
 * season_id changes from a non-manager. Name-only is therefore the DATABASE's
 * rule (D16), and nothing is re-checked here — no ownership test, no lock test.
 * A refusal arrives as a server message and goes through `translateRefusal`, the
 * same path every other refusal on this screen uses.
 *
 * Renaming stays available after the season locks, which is correct rather than an
 * oversight: 0002's registration lock fires on INSERT and DELETE only, because
 * D21 freezes the team SET (fixtures are derived from it) and not the labels on it.
 */
export function TeamNameEditor({
  teamId,
  name,
  onRenamed,
}: {
  teamId: string;
  name: string;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const start = () => {
    setDraft(name);
    setRefusal(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setRefusal(null);
  };

  const save = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await renameTeam({ teamId, name: draft });
      setEditing(false);
      onRenamed();
    } catch (err) {
      setRefusal(translateRefusal(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button className="btn-ghost" onClick={start} aria-label="Rename team">
        Rename team
      </button>
    );
  }

  const trimmed = draft.trim();
  return (
    <div className="card register-card">
      <h2 className="section-title">Rename your team</h2>
      <p className="page-sub">
        The name is cosmetic — it does not affect fixtures, your squad or your points.
      </p>
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      <div className="register-row">
        <input
          className="picker-search"
          value={draft}
          maxLength={60}
          placeholder="Team name"
          aria-label="New team name"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={busy || trimmed.length === 0 || trimmed === name}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save name"}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

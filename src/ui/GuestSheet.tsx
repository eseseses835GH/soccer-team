// "אורח" (v23): name (+ level for an organizer) → he plays tonight. Used on check-in screens.
import { useState } from 'react';
import { cleanName, sameName } from '../sync/playerGroup';
import { LevelPicker, Sheet } from './components';

export const NAME_TAKEN = 'כבר יש שחקן בשם הזה';

export function GuestSheet({
  players,
  withLevel,
  onAdd,
  onClose,
}: {
  players: { name: string }[];
  withLevel?: boolean;
  /** Resolves to an error to show, or null when he was added (the sheet closes). */
  onAdd: (name: string, level: number) => Promise<string | null> | string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = cleanName(name);
  const taken = !!sameName(players, n);
  return (
    <Sheet title="אורח" onClose={onClose}>
      <form
        className="late-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!n || taken || busy) return;
          setBusy(true);
          const err = await onAdd(n, level);
          setBusy(false);
          if (err) setError(err);
          else onClose();
        }}
      >
        <input
          id="guest-name"
          className="input"
          placeholder="שם"
          aria-label="שם האורח"
          value={name}
          maxLength={24}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {(taken || error) && <p className="field-error">{taken ? NAME_TAKEN : error}</p>}
        {withLevel && (
          <>
            <span className="label">רמה</span>
            <LevelPicker value={level} onChange={setLevel} />
          </>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!n || taken || busy}>
          הוספה
        </button>
      </form>
    </Sheet>
  );
}

// "אורח" (v23): name (+ level) → he plays tonight. Used on check-in screens. A player's sheet also
// offers "קבוע בקבוצה", which waits for an organizer's approval (pendingRegular).
import { useState } from 'react';
import { cleanName, sameName } from '../sync/playerGroup';
import { LevelPicker, Segmented, Sheet } from './components';

export const NAME_TAKEN = 'כבר יש שחקן בשם הזה';

/** "קבוע בקבוצה" / "אורח להיום" + one line. `player`: a regular waits for an organizer. */
export function KindChoice({ guest, onChange, player }: { guest: boolean; onChange: (guest: boolean) => void; player?: boolean }) {
  const hint = guest
    ? player
      ? 'רק להיום'
      : 'אחרי הערב יעבור ל״מזדמנים״, בתחתית רשימת השחקנים'
    : player
      ? 'ייכנס כקבוע אחרי אישור מארגן'
      : 'יתווסף לרשימת השחקנים של הקבוצה';
  return (
    <>
      <Segmented
        label="קבוע או אורח"
        value={guest ? 'guest' : 'regular'}
        onChange={(v) => onChange(v === 'guest')}
        options={[
          { value: 'regular', label: 'קבוע בקבוצה' },
          { value: 'guest', label: 'אורח להיום' },
        ]}
      />
      <p className="hint small">{hint}</p>
    </>
  );
}

export function GuestSheet({
  players,
  withLevel,
  withKind,
  onAdd,
  onClose,
}: {
  players: { name: string }[];
  withLevel?: boolean;
  /** A player's sheet: "קבוע בקבוצה" / "אורח להיום" (default אורח). */
  withKind?: boolean;
  /** Resolves to an error to show, or null when he was added (the sheet closes). */
  onAdd: (name: string, level: number, regular: boolean) => Promise<string | null> | string | null;
  onClose: () => void;
}) {
  const [guest, setGuest] = useState(true);
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = cleanName(name);
  const taken = !!sameName(players, n);
  return (
    <Sheet title={withKind ? 'מישהו חדש' : 'אורח'} onClose={onClose}>
      <form
        className="late-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!n || taken || busy) return;
          setBusy(true);
          const err = await onAdd(n, level, withKind ? !guest : false);
          setBusy(false);
          if (err) setError(err);
          else onClose();
        }}
      >
        <input
          id="guest-name"
          className="input"
          placeholder="שם"
          aria-label={withKind ? 'שם' : 'שם האורח'}
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
        {withKind && <KindChoice guest={guest} onChange={setGuest} player />}
        <button type="submit" className="btn btn-primary btn-block" disabled={!n || taken || busy}>
          הוספה
        </button>
      </form>
    </Sheet>
  );
}

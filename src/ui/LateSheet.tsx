import { useState } from 'react';
import { randomSeed, scoreFromCost, type SwapSuggestion } from '../engine';
import { applyCards } from '../state/cards';
import { lateArrive, suggestAfterLate, type LateArrival } from '../state/late';
import { newId, teamLook, verb, type Player } from '../state/model';
import { leaveCtx } from '../state/reducer';
import { useStore } from '../state/store';
import { arrivalChoices, benchTarget } from '../sync/runnerLate';
import { useVoterId } from '../sync/SyncProvider';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { cleanName, sameName } from '../sync/playerGroup';
import { newGuest } from '../state/guests';
import { Avatar } from '../photos/Avatar';
import { useUi } from './App';
import { LevelPicker, Sheet } from './components';
import { KindChoice, NAME_TAKEN } from './GuestSheet';
import { usePlayerGate } from './useGate';

const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} ו${list[list.length - 1]}`);

/**
 * "הגיע מאוחר" / "מישהו הגיע?" / ticking someone at home once teams exist (v38): tap everyone who
 * arrived → "נכנסים": short teams first, then a new team waiting outside once there are enough
 * (`lateArrive`), or the quiet "מחכים בצד" → if they completed the teams, an optional swap or two.
 * `mode: 'runner'` (a player running the match, no ratings on his phone): the roster by name, the
 * bench (a tap brings a sub in), a new guest added on the server, no swap suggestions (v15, v23).
 */
export function LateSheet({ onClose, arrived, mode }: { onClose: () => void; arrived?: Player; mode?: 'runner' }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [picked, setPicked] = useState<string[]>(arrived ? [arrived.id] : []);
  /** New to the roster, added here (not in the store until they arrive). */
  const [added, setAdded] = useState<Player[]>([]);
  const [suggest, setSuggest] = useState<{ s: SwapSuggestion; names: string[] } | null>(null);
  const r = state.result;
  if (!r) return null;
  const m = state.match;
  const look = (t: number) => teamLook(state.settings, t);
  const byId = new Map([...state.players, ...added].map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';

  if (suggest) {
    const { s } = suggest;
    return (
      <Sheet title="הקבוצות התמלאו" onClose={onClose}>
        <p className="lead">
          אפשר לשפר את האיזון מ-<strong>{scoreFromCost(s.before)}</strong> ל-<strong>{scoreFromCost(s.after)}</strong> עם{' '}
          {s.swaps.length === 1 ? 'החלפה אחת' : 'שתי החלפות'}:
        </p>
        <ul className="swap-list">
          {s.swaps.map(([i, j]) => (
            <li key={`${i}-${j}`}>
              {nameOf(suggest.names[i])} ⇄ {nameOf(suggest.names[j])}
            </li>
          ))}
        </ul>
        <div className="stack">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              dispatch({ type: 'applyAssignment', assignment: s.assignment, swaps: s.swaps });
              notify('בוצע');
              onClose();
            }}
          >
            להחליף
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={onClose}>
            להשאיר ככה
          </button>
        </div>
      </Sheet>
    );
  }

  const { roster, bench } = arrivalChoices(state.players, r, state.history);
  const list = [...added, ...roster];
  const toggle = (id: string) => setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]));
  const add = (p: Player) => {
    setAdded((ps) => [...ps, p]);
    setPicked((ps) => [...ps, p.id]);
  };
  const n = picked.length;

  const summary = (j: LateArrival) => {
    const parts: string[] = [];
    for (const t of new Set(j.placed.map((x) => x.team))) {
      const ids = j.placed.filter((x) => x.team === t).map((x) => x.id);
      parts.push(`${names(ids.map(nameOf))} ${ids.length > 1 ? 'נכנסו' : 'נכנס'} ${look(t).to}`);
    }
    for (const t of j.newTeams) {
      const tl = look(t);
      parts.push(`${verb(tl, 'נוצרו', 'נוצרה')} ${tl.the} · ${verb(tl, 'ממתינים', 'ממתינה')} בתור`);
    }
    if (j.waiting.length) parts.push(`${names(j.waiting.map(nameOf))} ${j.waiting.length > 1 ? 'מחכים' : 'מחכה'} בצד`);
    return parts.join(' · ');
  };

  const go = (wait: boolean) => {
    if (!n) return;
    const seed = randomSeed();
    const fresh = added.filter((p) => picked.includes(p.id));
    const ctx = leaveCtx({ ...state, players: [...state.players, ...fresh] });
    const j = lateArrive(r, m, picked, wait ? 'wait' : 'in', ctx, seed);
    dispatch({ type: 'lateArrive', ...(fresh.length ? { players: fresh } : {}), ids: picked, wait, seed, now: Date.now() });
    notify(summary(j));
    const s = mode === 'runner' ? null : suggestAfterLate(j, ctx);
    if (s) return setSuggest({ s, names: j.result.playerIds });
    onClose();
  };

  const chip = (p: Player, on: boolean, onClick: () => void) => (
    <button key={p.id} type="button" className={`member chip ${on ? 'sel' : ''}`} aria-pressed={on} onClick={onClick}>
      <Avatar player={p} size={28} />
      {p.name}
    </button>
  );

  return (
    <Sheet title="מי הגיע?" onClose={onClose}>
      {list.length > 0 && <div className="leave-chips late-picks">{list.map((p) => chip(p, picked.includes(p.id), () => toggle(p.id)))}</div>}
      <div className="late-go">
        <button type="button" className="btn btn-primary btn-block" disabled={!n} onClick={() => go(false)}>
          {n > 1 ? `נכנסים (${n})` : 'נכנס'}
        </button>
        <button type="button" className="text-btn quiet" disabled={!n} onClick={() => go(true)}>
          {n > 1 ? 'מחכים בצד' : 'מחכה בצד'}
        </button>
      </div>
      {mode === 'runner' && bench.length > 0 && (
        <>
          <span className="label">מחליפים</span>
          <div className="leave-chips">
            {bench.map((p) =>
              chip(p, false, () => {
                // From the bench: a sub coming in, as on the teams screen.
                const t = benchTarget(r);
                dispatch({ type: 'subIn', subId: p.id, team: t });
                notify(`${p.name} נכנס ${look(t).to}`);
                onClose();
              }),
            )}
          </div>
        </>
      )}
      {mode === 'runner' ? <RunnerNew onAdd={add} added={added} /> : <OrganizerNew onAdd={add} added={added} />}
    </Sheet>
  );
}

/** "מישהו חדש" on the organizer's phone: name, level, guest or regular; added to the picks. */
function OrganizerNew({ onAdd, added }: { onAdd: (p: Player) => void; added: Player[] }) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [guest, setGuest] = useState(false);
  const voter = useVoterId();
  const gate = usePlayerGate();
  const taken = [...state.players, ...added].some((p) => p.name.trim() === name.trim());
  return (
    <form
      className="late-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || taken) return;
        const p: Player = guest
          ? newGuest(newId(), name, level, voter)
          : { id: newId(), name: name.trim().slice(0, 24), attrs: applyCards(level, []), canGK: false, cards: [], ...(voter ? { levelVotes: { [voter]: level } } : {}) };
        gate([...added, p], () => {
          onAdd(p);
          setName('');
        });
      }}
    >
      <label className="label" htmlFor="late-name">
        מישהו חדש
      </label>
      <input id="late-name" className="input" placeholder="שם" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
      {taken && <p className="field-error">כבר יש שחקן בשם הזה, בחרו אותו מהרשימה</p>}
      <span className="label">רמה</span>
      <LevelPicker value={level} onChange={setLevel} />
      <KindChoice guest={guest} onChange={setGuest} />
      <button type="submit" className="btn btn-quiet btn-block" disabled={!name.trim() || taken}>
        הוספה
      </button>
    </form>
  );
}

/** "מישהו חדש" on a player runner's phone: added on the server (v23), then to the picks. */
function RunnerNew({ onAdd, added }: { onAdd: (p: Player) => void; added: Player[] }) {
  const { state } = useStore();
  const pg = usePlayerGroup();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [guest, setGuest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = cleanName(name);
  const taken = !!sameName([...state.players, ...added], n);
  const addGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!n || taken || busy) return;
    setBusy(true);
    const res = await pg.addGuest(n, level, !guest);
    setBusy(false);
    if ('id' in res) {
      onAdd(newGuest(res.id, n, level));
      setName('');
      return;
    }
    setError(GUEST_ERROR[res.error] ?? 'משהו השתבש, נסו שוב');
  };
  return (
    <form className="late-new" onSubmit={addGuest}>
      <label className="label" htmlFor="late-guest">
        מישהו חדש
      </label>
      <input
        id="late-guest"
        className="input"
        placeholder="שם"
        value={name}
        maxLength={24}
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      {(taken || error) && <p className="field-error">{taken ? NAME_TAKEN : error}</p>}
      <span className="label">רמה</span>
      <LevelPicker value={level} onChange={setLevel} />
      <KindChoice guest={guest} onChange={setGuest} player />
      <button type="submit" className="btn btn-quiet btn-block" disabled={!n || taken || busy}>
        הוספה
      </button>
    </form>
  );
}

/** Why the server didn't add a guest (v23). */
export const GUEST_ERROR: Partial<Record<string, string>> = {
  name: NAME_TAKEN,
  offline: 'אין חיבור לאינטרנט',
  denied: 'רק מי שמנהל את הערב',
  conflict: 'רק מי שמנהל את הערב',
  limit: 'הקבוצה מלאה',
};

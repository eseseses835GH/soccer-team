import { useState } from 'react';
import { randomSeed, scoreFromCost, type SwapSuggestion } from '../engine';
import { applyCards } from '../state/cards';
import { lateJoin, nowTarget, suggestAfterLate, type LateChoice } from '../state/late';
import { inProgress } from '../state/leave';
import { newId, teamLook, type Player } from '../state/model';
import { leaveCtx } from '../state/reducer';
import { useStore } from '../state/store';
import { arrivalChoices, benchTarget } from '../sync/runnerLate';
import { useVoterId } from '../sync/SyncProvider';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { cleanName, sameName } from '../sync/playerGroup';
import { newGuest, pickOrder } from '../state/guests';
import { useUi } from './App';
import { CardBadges, LevelPicker, Sheet, Toggle } from './components';
import { NAME_TAKEN } from './GuestSheet';
import { usePlayerGate } from './useGate';

type Step = { kind: 'pick' } | { kind: 'choose'; player: Player; isNew: boolean; sub?: boolean } | { kind: 'suggest'; s: SwapSuggestion; names: string[] };

/**
 * "הגיע מאוחר" / "מישהו הגיע?": pick who arrived → he goes in now (the suggested team, or
 * another with a tap) or waits on the side → if he completed the teams, an optional swap or two.
 * `mode: 'runner'` (a player running the match, no ratings on his phone): roster, bench or a new
 * guest at level 5 (v23), the smallest team and no swap suggestions (DECISIONS → v15).
 */
export function LateSheet({ onClose, arrived, mode }: { onClose: () => void; arrived?: Player; mode?: 'runner' }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [step, setStep] = useState<Step>(arrived ? { kind: 'choose', player: arrived, isNew: false } : { kind: 'pick' });
  const r = state.result;
  if (!r) return null;
  const m = state.match;
  const look = (t: number) => teamLook(state.settings, t);

  if (step.kind === 'pick')
    return mode === 'runner' ? (
      <RunnerPick onClose={onClose} onPick={(player, sub, isNew) => setStep({ kind: 'choose', player, isNew: !!isNew, sub })} />
    ) : (
      <PickStep onClose={onClose} onPick={(player, isNew) => setStep({ kind: 'choose', player, isNew })} />
    );

  if (step.kind === 'suggest') {
    const { s, names } = step;
    const nameOf = (id: string) => (state.players.find((p) => p.id === id)?.name ?? '?');
    return (
      <Sheet title="הקבוצות התמלאו" onClose={onClose}>
        <p className="lead">
          אפשר לשפר את האיזון מ-<strong>{scoreFromCost(s.before)}</strong> ל-<strong>{scoreFromCost(s.after)}</strong> עם{' '}
          {s.swaps.length === 1 ? 'החלפה אחת' : 'שתי החלפות'}:
        </p>
        <ul className="swap-list">
          {s.swaps.map(([i, j]) => (
            <li key={`${i}-${j}`}>
              {nameOf(names[i])} ⇄ {nameOf(names[j])}
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

  const { player, isNew, sub } = step;
  const live = inProgress(m);
  const context = m && live ? `משחק באמצע · ${look(m.onPitch[0]).name} נגד ${look(m.onPitch[1]).name}` : m?.history.length ? 'בין משחקים' : 'עוד לא התחיל משחק';
  const target = sub ? benchTarget(r) : nowTarget(r);
  const others = Array.from({ length: r.numTeams }, (_, t) => t).filter((t) => t !== target);

  const choose = (choice: LateChoice) => {
    if (sub) {
      // From the bench: a sub coming in, as on the teams screen.
      const t = choice.kind === 'now' ? (choice.team ?? target) : null;
      if (t !== null) {
        dispatch({ type: 'subIn', subId: player.id, team: t });
        notify(`${player.name} נכנס ${look(t).to}`);
      }
      return onClose();
    }
    const seed = randomSeed();
    const ctx = leaveCtx(isNew ? { ...state, players: [...state.players, player] } : state);
    const j = lateJoin(r, m, player.id, choice, ctx, seed);
    dispatch({ type: 'lateJoin', player: isNew ? player : undefined, id: player.id, choice, seed, now: Date.now() });
    const tl = j.team !== null ? look(j.team) : null;
    if (j.outcome === 'bench') notify(`${player.name} מחכה בצד`);
    else if (j.outcome === 'newTeam') notify(`נפתחה קבוצה חדשה: ${tl!.the}`);
    else if (j.outcome === 'joined') notify(`${player.name} הצטרף ${tl!.to}`);
    else {
      notify(`${player.name} השלים את ${tl!.the}`);
      const s = mode === 'runner' ? null : suggestAfterLate(j, ctx);
      if (s) return setStep({ kind: 'suggest', s, names: j.result.playerIds });
    }
    onClose();
  };

  return (
    <Sheet title={`${player.name} הגיע`} onClose={onClose}>
      <p className="lead">{context}</p>
      <div className="stack">
        <button type="button" className="btn btn-primary btn-block" onClick={() => choose({ kind: 'now' })}>
          נכנס עכשיו {target === r.numTeams ? '· קבוצה חדשה' : look(target).to}
        </button>
        {others.length > 0 && (
          <div className="leave-chips center" role="group" aria-label="לקבוצה אחרת">
            {others.map((t) => (
              <button
                key={t}
                type="button"
                className="member chip late-team"
                style={{ '--team': look(t).color } as React.CSSProperties}
                onClick={() => choose({ kind: 'now', team: t })}
              >
                <span className="dot" aria-hidden="true" /> {look(t).name}
              </button>
            ))}
          </div>
        )}
        {!sub && (
          <button type="button" className="btn btn-quiet btn-block" onClick={() => choose({ kind: 'wait' })}>
            מחכה בצד
          </button>
        )}
      </div>
    </Sheet>
  );
}

function PickStep({ onClose, onPick }: { onClose: () => void; onPick: (p: Player, isNew: boolean) => void }) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const [guest, setGuest] = useState(false);
  const voter = useVoterId();
  const gate = usePlayerGate();
  const inGame = new Set([...(state.result?.playerIds ?? []), ...(state.result?.subIds ?? [])]);
  // Regulars A–Z, then guests by how often they played (v23).
  const others = pickOrder(state.players.filter((p) => !inGame.has(p.id)), state.history);
  const taken = state.players.some((p) => p.name.trim() === name.trim());
  return (
    <Sheet title="מי הגיע?" onClose={onClose}>
      {others.length > 0 && (
        <ul className="pick-list">
          {others.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p, false)}>
                <span className="name">{p.name}</span>
                <CardBadges cards={p.cards} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="late-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || taken) return;
          const p: Player = guest
            ? newGuest(newId(), name, level, voter)
            : { id: newId(), name: name.trim().slice(0, 24), attrs: applyCards(level, []), canGK: false, cards: [], ...(voter ? { levelVotes: { [voter]: level } } : {}) };
          gate([p], () => onPick(p, true));
        }}
      >
        <label className="label" htmlFor="late-name">
          מישהו חדש
        </label>
        <input id="late-name" className="input" placeholder="שם" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
        {taken && <p className="field-error">כבר יש שחקן בשם הזה, בחרו אותו מהרשימה</p>}
        <span className="label">רמה</span>
        <LevelPicker value={level} onChange={setLevel} />
        <Toggle label="אורח" hint="לא קבוע" checked={guest} onChange={setGuest} />
        <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim() || taken}>
          המשך
        </button>
      </form>
    </Sheet>
  );
}

/** A player runner's pick: the roster (names only), the bench, or a new guest (level 5, added on the server). */
function RunnerPick({ onClose, onPick }: { onClose: () => void; onPick: (p: Player, sub: boolean, isNew?: boolean) => void }) {
  const { state } = useStore();
  const pg = usePlayerGroup();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.result) return null;
  const n = cleanName(name);
  const taken = !!sameName(state.players, n);
  const addGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!n || taken || busy) return;
    setBusy(true);
    const res = await pg.addGuest(n);
    setBusy(false);
    if ('id' in res) return onPick(newGuest(res.id, n), false, true);
    setError(GUEST_ERROR[res.error] ?? 'משהו השתבש, נסו שוב');
  };
  const { roster, bench } = arrivalChoices(state.players, state.result, state.history);
  const list = (ps: Player[], sub: boolean) => (
    <ul className="pick-list">
      {ps.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onPick(p, sub)}>
            <span className="name">{p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <Sheet title="מי הגיע?" onClose={onClose}>
      {roster.length > 0 && list(roster, false)}
      {bench.length > 0 && (
        <>
          <span className="label">מחליפים</span>
          {list(bench, true)}
        </>
      )}
      <form className="late-new" onSubmit={addGuest}>
        <label className="label" htmlFor="late-guest">
          אורח
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
        <button type="submit" className="btn btn-primary btn-block" disabled={!n || taken || busy}>
          המשך
        </button>
      </form>
    </Sheet>
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

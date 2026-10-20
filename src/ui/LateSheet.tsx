import { useState } from 'react';
import { randomSeed, scoreFromCost, type SwapSuggestion } from '../engine';
import { applyCards } from '../state/cards';
import { lateJoin, nowTarget, suggestAfterLate, type LateChoice } from '../state/late';
import { inProgress } from '../state/leave';
import { newId, teamLook, type Player } from '../state/model';
import { leaveCtx } from '../state/reducer';
import { useStore } from '../state/store';
import { useUi } from './App';
import { CardBadges, LevelPicker, Sheet } from './components';

type Step = { kind: 'pick' } | { kind: 'choose'; player: Player; isNew: boolean } | { kind: 'suggest'; s: SwapSuggestion; names: string[] };

/**
 * "הגיע מאוחר" / "מישהו הגיע?": pick who arrived → he goes in now (the suggested team, or
 * another with a tap) or waits on the side → if he completed the teams, an optional swap or two.
 */
export function LateSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const r = state.result;
  if (!r) return null;
  const m = state.match;
  const look = (t: number) => teamLook(state.settings, t);

  if (step.kind === 'pick') return <PickStep onClose={onClose} onPick={(player, isNew) => setStep({ kind: 'choose', player, isNew })} />;

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

  const { player, isNew } = step;
  const live = inProgress(m);
  const context = m && live ? `משחק באמצע · ${look(m.onPitch[0]).name} נגד ${look(m.onPitch[1]).name}` : m?.history.length ? 'בין משחקים' : 'עוד לא התחיל משחק';
  const target = nowTarget(r);
  const others = Array.from({ length: r.numTeams }, (_, t) => t).filter((t) => t !== target);

  const choose = (choice: LateChoice) => {
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
      const s = suggestAfterLate(j, ctx);
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
        <button type="button" className="btn btn-quiet btn-block" onClick={() => choose({ kind: 'wait' })}>
          מחכה בצד
        </button>
      </div>
    </Sheet>
  );
}

function PickStep({ onClose, onPick }: { onClose: () => void; onPick: (p: Player, isNew: boolean) => void }) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const inGame = new Set([...(state.result?.playerIds ?? []), ...(state.result?.subIds ?? [])]);
  const others = state.players.filter((p) => !inGame.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
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
          onPick({ id: newId(), name: name.trim().slice(0, 24), attrs: applyCards(level, []), canGK: false, cards: [] }, true);
        }}
      >
        <label className="label" htmlFor="late-name">
          מישהו חדש
        </label>
        <input id="late-name" className="input" placeholder="שם" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
        {taken && <p className="field-error">כבר יש שחקן בשם הזה, בחרו אותו מהרשימה</p>}
        <span className="label">רמה</span>
        <LevelPicker value={level} onChange={setLevel} />
        <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim() || taken}>
          המשך
        </button>
      </form>
    </Sheet>
  );
}

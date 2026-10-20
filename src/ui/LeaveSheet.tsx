import { useState } from 'react';
import { scoreFromCost } from '../engine';
import { teamMembers } from '../state/history';
import { inProgress, leaveEarly, suggestAfterLeave, type Leave, type LeaveSuggestion } from '../state/leave';
import { teamLook } from '../state/model';
import { leaveCtx } from '../state/reducer';
import { useStore } from '../state/store';
import { useUi } from './App';
import { Sheet } from './components';

const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} ו${list[list.length - 1]}`);

type Step = { kind: 'pick' } | { kind: 'confirm'; id: string; plan: Leave } | { kind: 'suggest'; s: LeaveSuggestion; team: number };

/**
 * "מישהו עזב?": pick who left → confirm (with what will happen) → an optional small fix
 * (a sub comes in, or a swap or two). The mirror of a late arrival: nobody is reshuffled.
 */
export function LeaveSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const r = state.result;
  if (!r) return null;
  const m = state.match;
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const look = (t: number) => teamLook(state.settings, t);
  const live = inProgress(m);
  const count = (res: typeof r, t: number) => res.assignment.filter((x) => x === t).length;

  if (step.kind === 'pick') {
    return (
      <Sheet title="מי עזב?" onClose={onClose}>
        <p className="lead">הוא יוצא מהכוחות של היום, בלי לערבב את כולם. המשחקים ששוחקו נשארים כמו שהם.</p>
        <div className="leave-teams">
          {Array.from({ length: r.numTeams }, (_, t) => (
            <div key={t} className="leave-team" style={{ '--team': look(t).color } as React.CSSProperties}>
              <span className="leave-team-name">
                <span className="dot" aria-hidden="true" /> {look(t).name}
                {m?.onPitch.includes(t) && <span className="muted"> · על המגרש</span>}
              </span>
              <div className="leave-chips">
                {teamMembers(r, t).map((id) => (
                  <button key={id} type="button" className="member chip" onClick={() => setStep({ kind: 'confirm', id, plan: leaveEarly(r, m, id, leaveCtx(state))! })}>
                    {nameOf(id)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {r.subIds.length > 0 && (
            <div className="leave-team">
              <span className="leave-team-name">מחליפים</span>
              <div className="leave-chips">
                {r.subIds.map((id) => (
                  <button key={id} type="button" className="member chip" onClick={() => setStep({ kind: 'confirm', id, plan: leaveEarly(r, m, id, leaveCtx(state))! })}>
                    {nameOf(id)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  if (step.kind === 'confirm') {
    const { id, plan } = step;
    const name = nameOf(id);
    const t = plan.team;
    const tl = t !== null ? look(t) : null;
    const n = t !== null ? count(plan.result, t) : 0;
    const onPitchNow = t !== null && live && !!m?.onPitch.includes(t);
    let what: string;
    if (plan.outcome === 'sub') what = 'הוא יוצא מהמחליפים.';
    else if (plan.outcome === 'blocked') what = `אי אפשר: ${tl?.in} יישאר שחקן אחד ואין מחליף. כדי להמשיך צריך חלוקה מחדש מהמסך הראשי.`;
    else if (plan.outcome === 'subIn') what = `${nameOf(plan.subId!)} נכנס במקומו ${tl?.to}.`;
    else if (plan.outcome === 'toBench') what = `${tl?.in} נשארים ${n}, מעט מדי לקבוצה: ${names(plan.result.subIds.map(nameOf))} מחכים בחוץ כמחליפים.`;
    else what = `${tl?.in} נשארים ${n}${onPitchNow ? ' וממשיכים ככה במשחק הזה' : ''}.`;
    const confirm = () => {
      dispatch({ type: 'leave', id, now: Date.now() });
      const s = suggestAfterLeave(plan, leaveCtx(state));
      if (s) return setStep({ kind: 'suggest', s, team: t! });
      notify(
        plan.outcome === 'toBench'
          ? `${name} עזב · שחקני ${tl?.the} מחכים כמחליפים`
          : plan.outcome === 'subIn'
            ? `${name} עזב · ${nameOf(plan.subId!)} נכנס במקומו`
            : plan.outcome === 'short'
              ? `${name} עזב · ${tl?.in} נשארו ${n}`
              : `${name} עזב`,
      );
      onClose();
    };
    return (
      <Sheet title={`${name} עזב?`} onClose={onClose}>
        <p className="lead">{what}</p>
        {plan.outcome === 'blocked' ? (
          <button type="button" className="btn btn-quiet btn-block" onClick={onClose}>
            סגירה
          </button>
        ) : (
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" onClick={confirm}>
              כן, הוא עזב
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => setStep({ kind: 'pick' })}>
              לא, מישהו אחר
            </button>
          </div>
        )}
      </Sheet>
    );
  }

  const { s, team } = step;
  const tl = look(team);
  const n = count(r, team);
  if (s.kind === 'sub') {
    const before = scoreFromCost(s.before);
    const after = scoreFromCost(s.after);
    const others = r.subIds.filter((id) => id !== s.subId);
    const bringIn = (subId: string) => {
      dispatch({ type: 'subIn', subId, team });
      notify(`${nameOf(subId)} נכנס ${tl.to}`);
      onClose();
    };
    return (
      <Sheet title="להכניס מחליף?" onClose={onClose}>
        <p className="lead">
          {tl.in} נשארו {n}. הכי מתאים להם: <strong>{nameOf(s.subId)}</strong>.
          {after !== before && (
            <>
              {' '}
              האיזון {after > before ? 'עולה' : 'יורד'} מ-<strong>{before}</strong> ל-<strong>{after}</strong>.
            </>
          )}
        </p>
        <div className="stack">
          <button type="button" className="btn btn-primary btn-block" onClick={() => bringIn(s.subId)}>
            {nameOf(s.subId)} נכנס
          </button>
          {others.length > 0 && (
            <div className="leave-chips center" aria-label="מחליף אחר">
              {others.map((id) => (
                <button key={id} type="button" className="member chip" onClick={() => bringIn(id)}>
                  {nameOf(id)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-quiet btn-block" onClick={onClose}>
            להשאיר ככה
          </button>
        </div>
      </Sheet>
    );
  }

  const sw = s.swaps;
  return (
    <Sheet title="לאזן מחדש?" onClose={onClose}>
      <p className="lead">
        {tl.in} נשארו {n}. אפשר לשפר את האיזון מ-<strong>{scoreFromCost(sw.before)}</strong> ל-<strong>{scoreFromCost(sw.after)}</strong> עם{' '}
        {sw.swaps.length === 1 ? 'החלפה אחת' : 'שתי החלפות'}:
      </p>
      <ul className="swap-list">
        {sw.swaps.map(([i, j]) => (
          <li key={`${i}-${j}`}>
            {nameOf(r.playerIds[i])} ⇄ {nameOf(r.playerIds[j])}
          </li>
        ))}
      </ul>
      <div className="stack">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            dispatch({ type: 'applyAssignment', assignment: sw.assignment, swaps: sw.swaps });
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

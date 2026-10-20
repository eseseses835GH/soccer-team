import { useMemo, useState } from 'react';
import { borrowCost, scoreFromCost, suggestBorrowers, type BorrowInput } from '../engine';
import { borrowNeed, setBorrow, type MatchState } from '../match/match';
import { engineOptions, teamLook, type GameResult } from '../state/model';
import { useStore } from '../state/store';

const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} ו${list[list.length - 1]}`);

/**
 * Optional step after a match: the short team that is on the pitch completes
 * itself from the team that just lost. Suggests the borrower(s) that make the
 * next match as even as possible; tap to choose others, or skip.
 */
export function BorrowCard({ m, r, set }: { m: MatchState; r: GameResult; set: (next: MatchState) => void }) {
  const { state } = useStore();
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const sizes = useMemo(() => {
    const c = new Array<number>(r.numTeams).fill(0);
    r.assignment.forEach((t) => c[t]++);
    return c;
  }, [r]);
  const need = borrowNeed(m, sizes, r.teamSize);
  const idsOf = (t: number) => r.playerIds.filter((_, i) => r.assignment[i] === t);

  const plan = useMemo(() => {
    if (!need) return null;
    let missing = false;
    const get = (t: number) =>
      idsOf(t).flatMap((id) => {
        const p = byId.get(id);
        if (!p) missing = true;
        return p ? [p] : [];
      });
    const input: BorrowInput = {
      short: get(need.team),
      donors: get(need.from),
      opponent: get(need.opponent),
      need: need.need,
      options: engineOptions(state.settings),
      constraints: state.constraints,
    };
    // A player missing from the roster: don't guess.
    if (missing) return null;
    const best = suggestBorrowers(input);
    return best ? { input, best, donorIds: input.donors.map((p) => p.id) } : null;
  }, [need?.team, need?.from, need?.opponent, need?.need, r, byId, state.settings, state.constraints]);

  const matchNo = m.history.length;
  const [picked, setPicked] = useState<{ at: number; ids: string[] } | null>(null);

  if (!need || !plan) return null;
  const shortLook = teamLook(state.settings, need.team);
  const fromLook = teamLook(state.settings, need.from);
  const name = (id: string) => byId.get(id)?.name ?? '';

  // Already decided for this match: a compact line (or nothing if skipped).
  if (m.borrow && m.borrow.team === need.team) {
    if (!m.borrow.ids.length) return null;
    const many = m.borrow.ids.length > 1;
    return (
      <p className="borrow-done" style={{ '--team': shortLook.color } as React.CSSProperties}>
        <span>
          🔁 {names(m.borrow.ids.map(name))} {many ? 'משחקים' : 'משחק'} עם {shortLook.the} במשחק הזה
        </span>
        <button type="button" className="text-btn inline" onClick={() => set(setBorrow(m, null))}>
          שינוי
        </button>
      </p>
    );
  }

  const suggested = plan.best.picks.map((i) => plan.donorIds[i]);
  const chosen = picked && picked.at === matchNo ? picked.ids : suggested;
  const isSuggested = chosen.length === suggested.length && chosen.every((id) => suggested.includes(id));
  const complete = chosen.length === need.need;
  const score = complete
    ? scoreFromCost(borrowCost(plan.input, chosen.map((id) => plan.donorIds.indexOf(id)).sort((a, b) => a - b)))
    : null;
  const tap = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(-need.need);
    setPicked({ at: matchNo, ids: next });
  };
  const moves = suggested.length > 1 ? 'עוברים' : 'עובר';

  return (
    <section className="borrow" aria-label="השלמה מהמפסידה" style={{ '--team': shortLook.color } as React.CSSProperties}>
      <h3>
        משלימים את {shortLook.the} {fromLook.from}
      </h3>
      <p className="borrow-why">
        {isSuggested ? (
          <>
            מומלץ: <strong>{names(suggested.map(name))}</strong> {moves} {shortLook.to}, כך המשחק הבא הכי שווה.
          </>
        ) : (
          <>
            בחרתם {complete ? <strong>{names(chosen.map(name))}</strong> : `${chosen.length} מתוך ${need.need}`}. המומלץ: {names(suggested.map(name))}.
          </>
        )}
      </p>
      <div className="borrow-picks" role="group" aria-label={`שחקני ${fromLook.the}`}>
        {plan.donorIds.map((id) => {
          const on = chosen.includes(id);
          return (
            <button key={id} type="button" className={`member chip ${on ? 'sel' : ''}`} aria-pressed={on} onClick={() => tap(id)}>
              <span className="name">{name(id)}</span>
              {suggested.includes(id) && <small className="rec">מומלץ</small>}
            </button>
          );
        })}
      </div>
      <p className="hint small">
        {score !== null && (
          <>
            מדד המשחק הבא <strong className="borrow-score">{score}</strong>
            {!isSuggested && ` (עם ההמלצה ${plan.best.score})`}
            {' · '}
          </>
        )}
        רק למשחק הזה, אחריו חוזרים לקבוצה
      </p>
      <div className="row-2">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={!complete}
          onClick={() => set(setBorrow(m, { team: need.team, from: need.from, ids: chosen }))}
        >
          אישור
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => set(setBorrow(m, { team: need.team, from: need.from, ids: [] }))}>
          דילוג
        </button>
      </div>
    </section>
  );
}

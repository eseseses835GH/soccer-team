import { useState } from 'react';
import { MIN_TEAM_SIZE, planFormat, type FormatPlan } from '../engine';
import { presentPlayers, useStore } from '../state/store';
import { useUi } from './App';
import { CardBadges, Empty } from './components';
import { splitTeams } from './split';

const SIZES = Array.from({ length: 7 - MIN_TEAM_SIZE + 1 }, (_, i) => i + MIN_TEAM_SIZE); // 3..7 on the main screen

function planSentence(n: number, plan: FormatPlan | null, size: number): string {
  if (!plan) return n === 0 ? 'סמנו מי הגיע' : `צריך לפחות 4 שחקנים (יש ${n})`;
  const [a, b, ...rest] = plan.sizes;
  if (plan.reduced) return `אין מספיק ל-${size} בקבוצה, אז ${a} נגד ${b}`;
  let s = `${a} נגד ${b}`;
  if (rest.length === 1) s += rest[0] === size ? ' · עוד קבוצה בחוץ' : ` · ${rest[0]} בחוץ, משלימים ${size - rest[0]} מהמפסידה`;
  if (rest.length > 1) {
    const short = rest.filter((x) => x < size);
    s += ` · ${rest.length} קבוצות בחוץ`;
    if (short.length) s += `, אחת של ${short[0]}`;
  }
  if (plan.subs === 1) s += ' · מחליף אחד';
  if (plan.subs > 1) s += ` · ${plan.subs} מחליפים`;
  return s;
}

export function HomeScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const present = presentPlayers(state);
  const plan = planFormat(present.length, state.teamSize);
  const presentSet = new Set(state.presentIds);
  const now = () => Date.now();
  const sizes = SIZES.includes(state.teamSize) ? SIZES : [...SIZES, state.teamSize].sort((a, b) => a - b);

  const sorted = [...state.players]
    .filter((p) => !filter.trim() || p.name.includes(filter.trim()))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const lastAvailable = state.lastPresentIds.length > 0 && state.presentIds.length === 0;

  const go2 = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      if (await splitTeams(state, dispatch)) go('teams');
    } catch {
      notify('משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  if (state.players.length === 0) {
    return (
      <Empty icon="👟" title="בואו נכיר את החבר׳ה">
        <p>מוסיפים כל אחד פעם אחת. אחר כך רק מסמנים מי הגיע, והקבוצות מתחלקות לבד.</p>
        <div className="stack narrow">
          <button type="button" className="btn btn-primary btn-block" onClick={() => go('players')}>
            הוספת שחקנים
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => dispatch({ type: 'loadSample', now: now() })}>
            לנסות עם סגל לדוגמה
          </button>
        </div>
      </Empty>
    );
  }

  return (
    <section className="home" aria-labelledby="home-h">
      <div className="hero">
        <h1 id="home-h">מי הגיע היום?</h1>
        <p className="hero-count" aria-live="polite">
          <strong>{present.length}</strong> מתוך {state.players.length}
        </p>
      </div>

      <div className="size-row">
        <span className="label">כמה בקבוצה</span>
        <div className="size-pills" role="radiogroup" aria-label="כמה בקבוצה">
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={state.teamSize === s}
              className={state.teamSize === s ? 'on' : ''}
              onClick={() => dispatch({ type: 'setTeamSize', size: s })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="quick-row">
        {lastAvailable && (
          <button type="button" className="text-btn" onClick={() => dispatch({ type: 'setPresent', ids: state.lastPresentIds, now: now() })}>
            כמו בפעם הקודמת ({state.lastPresentIds.length})
          </button>
        )}
        <button type="button" className="text-btn" onClick={() => dispatch({ type: 'setPresent', ids: state.players.map((p) => p.id), now: now() })}>
          כולם
        </button>
        {state.presentIds.length > 0 && (
          <button type="button" className="text-btn" onClick={() => dispatch({ type: 'setPresent', ids: [], now: now() })}>
            ניקוי
          </button>
        )}
        {state.players.length > 12 && (
          <input className="search" placeholder="חיפוש" aria-label="חיפוש שחקן" value={filter} onChange={(e) => setFilter(e.target.value)} />
        )}
      </div>

      <ul className="attend">
        {sorted.map((p) => {
          const on = presentSet.has(p.id);
          return (
            <li key={p.id}>
              <label className={on ? 'on' : ''}>
                <input type="checkbox" checked={on} onChange={() => dispatch({ type: 'togglePresent', id: p.id, now: now() })} />
                <span className="tick" aria-hidden="true" />
                <span className="name">{p.name}</span>
                <CardBadges cards={p.cards} />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="list-foot">
        מישהו חסר?{' '}
        <button type="button" className="text-btn inline" onClick={() => go('players')}>
          הוספת שחקן
        </button>
      </p>

      <div className="cta-dock">
        <p className={`plan ${plan ? '' : 'warn'}`} aria-live="polite">
          {planSentence(present.length, plan, state.teamSize)}
        </p>
        <button type="button" className="btn btn-hero btn-block" disabled={!plan || busy} onClick={go2}>
          {busy ? 'מערבבים…' : 'עושים כוחות'}
        </button>
      </div>
    </section>
  );
}

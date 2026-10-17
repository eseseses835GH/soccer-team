import { useState } from 'react';
import { formatLabel, randomSeed, teamSizes } from '../engine';
import { MAX_TEAMS, MIN_PER_TEAM, engineOptions } from '../state/model';
import { presentPlayers, useStore } from '../state/store';
import { balance } from '../worker/balancer';
import { useUi } from './App';
import { EmptyState, Stepper } from './components';

export function GameScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const present = presentPlayers(state);
  const k = state.numTeams;
  const need = k * MIN_PER_TEAM;
  const enough = present.length >= need;
  const sizes = present.length >= k ? teamSizes(present.length, k) : [];
  const constraintCount = state.constraints.together.length + state.constraints.apart.length;
  const presentSet = new Set(state.presentIds);

  const sorted = [...state.players]
    .filter((p) => !filter.trim() || p.name.includes(filter.trim()))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const generate = async () => {
    if (!enough || busy) return;
    setBusy(true);
    try {
      const res = await balance({
        players: present,
        k,
        options: engineOptions(state.settings),
        constraints: state.constraints,
        seed: randomSeed(),
      });
      dispatch({ type: 'setResult', playerIds: present.map((p) => p.id), numTeams: k, best: res.best, pool: res.pool });
      go('teams');
    } catch {
      notify('משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  if (state.players.length === 0) {
    return (
      <EmptyState icon="📋" title="אין עדיין שחקנים">
        <p>קודם מוסיפים את החבר׳ה, ואז מסמנים מי הגיע.</p>
        <div className="stack">
          <button type="button" className="btn btn-primary" onClick={() => go('players')}>
            הוספת שחקנים
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'loadSample' })}>
            טעינת סגל לדוגמה
          </button>
        </div>
      </EmptyState>
    );
  }

  return (
    <section aria-labelledby="game-h" className="with-sticky">
      <div className="section-head">
        <h2 id="game-h">מי הגיע היום?</h2>
        <span className="muted" aria-live="polite">
          {present.length} מתוך {state.players.length}
        </span>
      </div>

      <div className="card setup">
        <div className="setup-row">
          <span className="field-label">מספר קבוצות</span>
          <Stepper label="מספר קבוצות" value={k} min={2} max={MAX_TEAMS} onChange={(n) => dispatch({ type: 'setNumTeams', n })} />
        </div>
        <div className="setup-row">
          <span className="field-label">מתכונת</span>
          <strong className="format" dir="rtl">
            {enough ? formatLabel(sizes) : '—'}
          </strong>
        </div>
        <div className="setup-row">
          <span className="field-label">אילוצים</span>
          <button type="button" className="link-btn" onClick={() => go('settings')}>
            {constraintCount ? `${constraintCount} פעילים · עריכה` : 'הוספה (יחד / בנפרד)'}
          </button>
        </div>
      </div>

      <div className="bulk">
        <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'setPresent', ids: state.players.map((p) => p.id) })}>
          סימון כולם
        </button>
        <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'setPresent', ids: [] })}>
          ניקוי
        </button>
        {state.players.length > 12 && (
          <>
            <label className="sr-only" htmlFor="filter">
              חיפוש שחקן
            </label>
            <input id="filter" className="input input-small" placeholder="חיפוש…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </>
        )}
      </div>

      <ul className="attend-list">
        {sorted.map((p) => {
          const on = presentSet.has(p.id);
          return (
            <li key={p.id}>
              <label className={`attend-row ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => dispatch({ type: 'togglePresent', id: p.id })} />
                <span className="checkmark" aria-hidden="true" />
                <span className="player-name">{p.name}</span>
                {p.canGK && (
                  <span className="chip" title="שוער">
                    🧤
                  </span>
                )}
                <span className="rating-badge small">{p.attrs.overall}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="sticky-cta">
        {!enough && (
          <p className="hint" role="status">
            צריך לפחות {need} שחקנים ל-{k} קבוצות (חסרים {need - present.length})
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block btn-big" disabled={!enough || busy} onClick={generate}>
          {busy ? 'מחשב…' : '⚽ חלוקה לקבוצות'}
        </button>
      </div>
    </section>
  );
}

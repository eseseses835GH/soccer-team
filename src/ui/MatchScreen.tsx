import { useEffect, useMemo, useRef, useState } from 'react';
import { scoreFromCost, suggestWeakeningSwap } from '../engine';
import {
  addGoal,
  borrowedInto,
  defaultOutOnDraw,
  dismissDominance,
  dominantTeam,
  elapsedMs,
  endMatch,
  keeperIndex,
  loserOf,
  pauseClock,
  resetClock,
  score,
  setLastScorer,
  standings,
  startClock,
  topScorers,
  undoGoal,
  type MatchState,
} from '../match/match';
import { engineOptions, teamLook } from '../state/model';
import { useStore } from '../state/store';
import { useUi } from './App';
import { BorrowCard } from './BorrowCard';
import { celebrateGoal, primeVoices, stopCelebration } from './celebrate';
import { Sheet } from './components';
import { GoalBurst } from './GoalBurst';
import { Icon } from './icons';

function fmt(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((at) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.3);
    });
  } catch {
    /* no audio */
  }
}

/** Keep the screen on while the clock runs (where supported). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        const l = await wl?.request('screen');
        if (cancelled) l?.release();
        else lock = l ?? null;
      } catch {
        /* not allowed */
      }
    };
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

export function MatchScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const m = state.match;
  const r = state.result;
  const [now, setNow] = useState(() => Date.now());
  const [scorerFor, setScorerFor] = useState<number | null>(null);
  const [drawAsk, setDrawAsk] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [burst, setBurst] = useState<{ id: number; team: number } | null>(null);
  useEffect(primeVoices, []);
  const buzzed = useRef<string>('');

  const running = !!m?.clock.running;
  useWakeLock(running);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);

  const limit = state.settings.matchMinutes * 60_000;
  const elapsed = m ? elapsedMs(m.clock, running ? now : Date.now()) : 0;
  const left = limit - elapsed;
  const matchKey = `${m?.history.length ?? 0}`;
  useEffect(() => {
    if (running && left <= 0 && buzzed.current !== matchKey) {
      buzzed.current = matchKey;
      try {
        navigator.vibrate?.([300, 120, 300]);
      } catch {
        /* ignore */
      }
      beep();
    }
  }, [running, left, matchKey]);

  // A team that keeps winning: offer one swap that weakens it.
  const dom = m && r ? dominantTeam(m, r.numTeams) : null;
  const weaken = useMemo(() => {
    if (dom === null || !r) return null;
    const players = r.playerIds.map((id) => byId.get(id)!);
    if (players.some((p) => !p)) return null;
    const c = new Array<number>(r.numTeams).fill(0);
    r.assignment.forEach((t) => c[t]++);
    return suggestWeakeningSwap(players, r.assignment, r.numTeams, dom, engineOptions(state.settings), state.constraints, c.sort((x, y) => y - x));
  }, [dom, r, byId, state.settings, state.constraints]);

  if (!m || !r) return null;

  const set = (next: MatchState) => dispatch({ type: 'setMatch', match: next, now: Date.now() });
  const k = r.numTeams;
  const [a, b] = m.onPitch;
  const [ga, gb] = score(m);
  const members = (t: number) => {
    const order = r.gkOrder[t]?.length ? r.gkOrder[t] : r.playerIds.filter((_, i) => r.assignment[i] === t);
    const inTeam = new Set(r.playerIds.filter((_, i) => r.assignment[i] === t));
    return order.filter((id) => inTeam.has(id));
  };
  /** Who can score for a team: its members plus anyone borrowed for this match. */
  const lineup = (t: number) => {
    const own = members(t);
    return [...own, ...borrowedInto(m, t).filter((id) => !own.includes(id))];
  };
  const keeper = (t: number) => {
    const order = members(t);
    const idx = state.settings.gkMode === 'rotate' ? keeperIndex(m.conceded[t] ?? 0, state.settings.gkSwitchGoals, order.length) : 0;
    return byId.get(order[idx])?.name ?? '';
  };
  const counts = new Array<number>(k).fill(0);
  r.assignment.forEach((t) => counts[t]++);

  const goal = (t: number) => {
    set(addGoal(m, t, Date.now()));
    setScorerFor(t);
    // Sound must start inside the tap (iOS); undoing a goal doesn't celebrate.
    celebrateGoal(state.settings.goalSound, teamLook(state.settings, t).name);
    setBurst({ id: Date.now(), team: t });
  };
  const sound = state.settings.goalSound !== 'off';
  const toggleSound = () => {
    if (sound) stopCelebration();
    dispatch({ type: 'setSettings', settings: { ...state.settings, goalSound: sound ? 'off' : 'all' } });
    notify(sound ? 'צליל הגול כבוי' : 'צליל הגול פועל');
  };

  const finish = (out: number) => {
    const outLook = teamLook(state.settings, out);
    const next = endMatch(m, out, Date.now());
    set(next);
    setDrawAsk(false);
    if (m.queue.length) {
      const inLook = teamLook(state.settings, m.queue[0]);
      notify(`ה${outLook.name} יוצאים · נכנסים ה${inLook.name}`);
    } else notify('המשחק נשמר');
  };
  const end = () => {
    const loser = loserOf(m);
    if (loser !== null) return finish(loser);
    if (!m.queue.length) return finish(a);
    setDrawAsk(true);
  };

  const table = standings(m, k);
  const scorers = topScorers(m).slice(0, 5);
  const nextUp = m.queue[0];

  return (
    <section className="match" aria-label="משחק">
      <button type="button" className={`icon-btn sound-toggle ${sound ? 'on' : ''}`} aria-label={sound ? 'השתקת צליל הגול' : 'הפעלת צליל הגול'} onClick={toggleSound}>
        <Icon name={sound ? 'sound' : 'mute'} size={20} />
      </button>
      <div className="match-no">משחק {m.history.length + 1}</div>
      <div className={`clock ${left <= 0 ? 'over' : ''}`} role="timer" aria-live="off">
        {left <= 0 ? `+${fmt(left)}` : fmt(left)}
      </div>
      <div className="clock-ctrl">
        <button type="button" className="btn btn-primary" onClick={() => set(running ? pauseClock(m, Date.now()) : startClock(m, Date.now()))}>
          <Icon name={running ? 'pause' : 'play'} size={20} /> {running ? 'עצירה' : elapsed > 0 ? 'המשך' : 'התחלה'}
        </button>
        {elapsed > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => set(resetClock(m))} aria-label="איפוס שעון">
            <Icon name="undo" size={20} />
          </button>
        )}
      </div>

      <div className="pitch">
        {[a, b].map((t, side) => {
          const look = teamLook(state.settings, t);
          return (
            <div key={t} className="side" style={{ '--team': look.color } as React.CSSProperties}>
              <h2>{look.name}</h2>
              <div className="goals" aria-label={`${look.name}: ${side === 0 ? ga : gb}`}>
                {side === 0 ? ga : gb}
              </div>
              <div className="keeper">🧤 {keeper(t)}</div>
              <button type="button" className="btn btn-goal" onClick={() => goal(t)}>
                + גול
              </button>
            </div>
          );
        })}
      </div>
      <div className="match-links">
        {m.goals.length > 0 && (
          <button type="button" className="text-btn" onClick={() => set(undoGoal(m))}>
            <Icon name="undo" size={18} /> ביטול גול אחרון
          </button>
        )}
      </div>

      <BorrowCard m={m} r={r} set={set} />

      {dom !== null && weaken && (
        <div className="notice tip">
          <p>
            ה{teamLook(state.settings, dom).name} שולטים ({m.streak[dom] >= 3 ? `${m.streak[dom]} ניצחונות ברצף` : 'רוב המשחקים'}). להחליף את{' '}
            <strong>{byId.get(r.playerIds[weaken.swaps[0][0]])?.name}</strong> ב-<strong>{byId.get(r.playerIds[weaken.swaps[0][1]])?.name}</strong>?
            <span className="muted"> מדד {scoreFromCost(weaken.before)} ← {scoreFromCost(weaken.after)}</span>
          </p>
          <div className="row-2">
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => {
                dispatch({ type: 'applyAssignment', assignment: weaken.assignment, swaps: weaken.swaps });
                set(dismissDominance(m, dom));
                notify('הוחלף');
              }}
            >
              להחליף
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => set(dismissDominance(m, dom))}>
              לא עכשיו
            </button>
          </div>
        </div>
      )}

      <div className="dock">
        <button type="button" className="btn btn-hero btn-block" onClick={end}>
          סיום משחק
        </button>
        {nextUp !== undefined && (
          <p className="hint center">
            הבאים: ה{teamLook(state.settings, nextUp).name}
            {counts[nextUp] < r.teamSize && ` · משלימים ${r.teamSize - counts[nextUp]} מהמפסידה`}
          </p>
        )}
      </div>

      {m.history.length > 0 && (
        <details className="fold" open>
          <summary>טבלת הערב</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">קבוצה</th>
                  <th scope="col">משחקים</th>
                  <th scope="col">נ</th>
                  <th scope="col">ת</th>
                  <th scope="col">ה</th>
                  <th scope="col">שערים</th>
                </tr>
              </thead>
              <tbody>
                {[...table]
                  .sort((x, y) => y.won - x.won || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst))
                  .map((row) => (
                    <tr key={row.team}>
                      <th scope="row">
                        <span className="dot" style={{ background: teamLook(state.settings, row.team).color }} /> {teamLook(state.settings, row.team).name}
                      </th>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.drawn}</td>
                      <td>{row.lost}</td>
                      <td dir="ltr">
                        {row.goalsFor}:{row.goalsAgainst}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {scorers.length > 0 && (
            <p className="scorers">
              ⚽ {scorers.map(([id, n]) => `${byId.get(id)?.name ?? '?'} ${n}`).join(' · ')}
            </p>
          )}
        </details>
      )}

      <div className="row-links">
        <button type="button" className="text-btn danger" onClick={() => setConfirmEnd(true)}>
          סיום הערב
        </button>
      </div>

      {scorerFor !== null && (
        <Sheet title={`מי הבקיע ל${teamLook(state.settings, scorerFor).name}?`} onClose={() => setScorerFor(null)}>
          <ul className="pick-list">
            {lineup(scorerFor).map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    set(setLastScorer(m, id));
                    setScorerFor(null);
                  }}
                >
                  <span className="name">{byId.get(id)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setScorerFor(null)}>
            דילוג
          </button>
        </Sheet>
      )}

      {burst && <GoalBurst key={burst.id} color={teamLook(state.settings, burst.team).color} onDone={() => setBurst(null)} />}

      {drawAsk && (
        <Sheet title="תיקו. מי יוצא?" onClose={() => setDrawAsk(false)}>
          <p className="lead">{defaultOutOnDraw(m) !== null ? 'בדרך כלל יוצאת הקבוצה שנמצאת יותר זמן על המגרש.' : 'משחק ראשון, אז תחליטו אתם.'}</p>
          <div className="stack">
            {[a, b].map((t) => (
              <button key={t} type="button" className={`btn btn-block ${defaultOutOnDraw(m) === t ? 'btn-primary' : 'btn-quiet'}`} onClick={() => finish(t)}>
                ה{teamLook(state.settings, t).name} יוצאים
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {confirmEnd && (
        <Sheet title="לסיים את הערב?" onClose={() => setConfirmEnd(false)}>
          <p className="lead">הטבלה והגולים יימחקו. הקבוצות נשארות.</p>
          <div className="stack">
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                dispatch({ type: 'setMatch', match: null, now: Date.now() });
                go('teams');
              }}
            >
              סיום הערב
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => setConfirmEnd(false)}>
              ביטול
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}


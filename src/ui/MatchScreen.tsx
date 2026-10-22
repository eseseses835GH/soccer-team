import { useEffect, useMemo, useRef, useState } from 'react';
import { scoreFromCost, suggestWeakeningSwap } from '../engine';
import {
  addGoal,
  adjustMatchLength,
  borrowedInto,
  defaultOutOnDraw,
  dismissDominance,
  dominantTeam,
  elapsedMs,
  endMatch,
  endOnPenalties,
  addDrawExtraTime,
  inDrawExtraTime,
  keeperIndex,
  loserOf,
  matchLength,
  MAX_MINUTES,
  MIN_MINUTES,
  MINUTE,
  pauseClock,
  resetClock,
  score,
  setLastScorer,
  setMatchLength,
  standings,
  startClock,
  topScorers,
  undoGoal,
  type MatchState,
} from '../match/match';
import { hasEveningData } from '../state/history';
import { defaultMatchMs, engineOptions, teamLook, verb } from '../state/model';
import { useStore } from '../state/store';
import { useUi } from './App';
import { BorrowCard } from './BorrowCard';
import { Sheet, Stepper, Toggle } from './components';
import { GoalBurst } from './GoalBurst';
import { Icon } from './icons';
import { LateSheet } from './LateSheet';
import { LeaveSheet } from './LeaveSheet';
import { useEndEvening } from './LiveControl';
import { celebrateGoal, playWhistle, stopSounds, unlockAudio, unlockOnNextTap } from './sounds';

/** Quick picks in the match length sheet, in minutes. */
const QUICK_MINUTES = [5, 6, 7, 8, 10, 12];

function fmt(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

/**
 * `runner`: a player running the match from his phone (sync/runner.ts) — late/left without
 * ratings (v15), no re-split, no dominance swap, no end of the evening; "stop running" instead.
 */
export function MatchScreen({ runner }: { runner?: { onRelease(): void } } = {}) {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const m = state.match;
  const r = state.result;
  const [now, setNow] = useState(() => Date.now());
  const [scorerFor, setScorerFor] = useState<number | null>(null);
  /** Level match: first "who won on penalties?", then (plain draw) "who leaves?". */
  const [drawAsk, setDrawAsk] = useState<false | 'pens' | 'leave'>(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const endEvening = useEndEvening();
  const [burst, setBurst] = useState<{ id: number; team: number } | null>(null);
  const [lengthOpen, setLengthOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  const soundOn = useRef(true);
  soundOn.current = state.settings.goalSound !== 'off';
  // After a reload the time-up whistle has no tap of its own: unlock audio on any tap first.
  useEffect(() => unlockOnNextTap(() => soundOn.current), []);
  const buzzed = useRef<string>('');
  /** The match whose full-time whistle already sounded (time-up or the end tap): never twice. */
  const whistled = useRef<string>('');

  const running = !!m?.clock.running;
  useWakeLock(running);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);

  // This match's length (null = no time limit): the settings' length unless changed for this match.
  const dflt = defaultMatchMs(state.settings);
  const limit = m ? matchLength(m, dflt) : dflt;
  const elapsed = m ? elapsedMs(m.clock, running ? now : Date.now()) : 0;
  const left = limit === null ? null : limit - elapsed;
  const over = left !== null && left <= 0;
  const matchKey = `${m?.history.length ?? 0}`;
  useEffect(() => {
    if (left === null) return;
    // Time left again (the length was extended past the clock, or the clock was reset): the new
    // finish whistles again when it comes.
    if (left > 0) {
      if (buzzed.current === matchKey) buzzed.current = '';
      return;
    }
    if (running && buzzed.current !== matchKey && m) {
      // Level when the time runs out: a whistle and automatic extra time (once per match).
      const extra = addDrawExtraTime(m, state.settings.drawExtraMinutes, dflt);
      if (extra !== m) {
        set(extra);
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* ignore */
        }
        playWhistle(state.settings.goalSound, 'start', false);
        return;
      }
      buzzed.current = matchKey;
      try {
        navigator.vibrate?.([300, 120, 300]);
      } catch {
        /* ignore */
      }
      // No tap here: if the phone hasn't unlocked audio, the vibration has to do (and the end tap whistles).
      if (playWhistle(state.settings.goalSound, 'end', false)) whistled.current = matchKey;
    }
  }, [running, left, matchKey, state.settings.goalSound]);

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
    celebrateGoal(state.settings.goalSound);
    setBurst({ id: Date.now(), team: t });
  };
  const sound = state.settings.goalSound !== 'off';
  const toggleSound = () => {
    if (sound) stopSounds();
    dispatch({ type: 'setSettings', settings: { ...state.settings, goalSound: sound ? 'off' : 'on' } });
    notify(sound ? 'הצלילים כבויים' : 'הצלילים פועלים');
  };
  const startStop = () => {
    if (running) return set(pauseClock(m, Date.now()));
    // The clock starts first, so nothing in the sound code can ever keep it from starting.
    set(startClock(m, Date.now()));
    // Kick-off whistle only for a fresh match, not when resuming after a pause. The tap also
    // unlocks audio for the time-up whistle later.
    if (elapsed === 0) playWhistle(state.settings.goalSound, 'start');
    else unlockAudio(sound);
  };
  /** A length picked in the sheet: this match, and the default for the next ones. */
  const pickLength = (minutes: number | null) => {
    set(setMatchLength(m, minutes === null ? null : minutes * MINUTE));
    const settings = minutes === null ? { ...state.settings, matchNoLimit: true } : { ...state.settings, matchMinutes: minutes, matchNoLimit: false };
    if (settings.matchMinutes !== state.settings.matchMinutes || settings.matchNoLimit !== state.settings.matchNoLimit) dispatch({ type: 'setSettings', settings });
  };
  const limitMin = limit === null ? null : Math.round(limit / MINUTE);
  /** Added (or removed) time in this match only, against the default length. */
  const added = limitMin !== null && !state.settings.matchNoLimit ? limitMin - state.settings.matchMinutes : 0;
  const addedText = `${added > 0 ? '+' : '−'}${Math.abs(added)}`;
  const lengthLabel = limitMin === null ? 'בלי הגבלת זמן' : `${limitMin} דק׳${added ? ` (${addedText})` : ''}`;

  const finish = (out: number) => {
    const outLook = teamLook(state.settings, out);
    const next = endMatch(m, out, Date.now());
    set(next);
    setDrawAsk(false);
    if (m.queue.length) {
      const inLook = teamLook(state.settings, m.queue[0]);
      notify(`${outLook.the} ${verb(outLook, 'יוצאים', 'יוצאת')} · ${verb(inLook, 'נכנסים', 'נכנסת')} ${inLook.the}`);
    } else notify('המשחק נשמר');
  };
  const end = () => {
    if (whistled.current !== matchKey) {
      whistled.current = matchKey;
      playWhistle(state.settings.goalSound, 'end');
    }
    const loser = loserOf(m);
    if (loser !== null) return finish(loser);
    setDrawAsk('pens');
  };
  /** A plain draw: with a queue, ask who leaves; with two teams nobody leaves. */
  const plainDraw = () => (m.queue.length ? setDrawAsk('leave') : finish(a));
  const finishOnPens = (winner: number) => {
    const loserT = winner === a ? b : a;
    set(endOnPenalties(m, winner, Date.now()));
    setDrawAsk(false);
    const w = teamLook(state.settings, winner);
    const won = `${w.the} ${verb(w, 'ניצחו', 'ניצחה')} בפנדלים`;
    if (m.queue.length) {
      const out = teamLook(state.settings, loserT);
      const next = teamLook(state.settings, m.queue[0]);
      notify(`${won} · ${out.the} ${verb(out, 'יוצאים', 'יוצאת')} · ${verb(next, 'נכנסים', 'נכנסת')} ${next.the}`);
    } else notify(won);
  };

  const table = standings(m, k);
  const scorers = topScorers(m).slice(0, 5);
  const nextUp = m.queue[0];

  return (
    <section className="match" aria-label="משחק">
      <button type="button" className={`icon-btn sound-toggle ${sound ? 'on' : ''}`} aria-label={sound ? 'השתקת הצלילים' : 'הפעלת הצלילים'} onClick={toggleSound}>
        <Icon name={sound ? 'sound' : 'mute'} size={20} />
      </button>
      <div className="match-no">משחק {m.history.length + 1}</div>
      {/* Tapping the clock opens the length sheet too; the chip below is the accessible control. */}
      <div className={`clock ${over ? 'over' : ''}`} role="timer" aria-live="off" onClick={() => setLengthOpen(true)}>
        {left === null ? fmt(elapsed) : over ? `+${fmt(left)}` : fmt(left)}
      </div>
      <button type="button" className="length-chip" onClick={() => setLengthOpen(true)} aria-label={`אורך המשחק: ${lengthLabel}. שינוי`}>
        ⏱ {limitMin === null ? lengthLabel : `${limitMin} דק׳`}
        {limitMin !== null && added !== 0 && (
          <span className="len-added" dir="ltr">
            {addedText}
          </span>
        )}
      </button>
      {inDrawExtraTime(m) && (
        <button type="button" className="extra-note" onClick={() => setLengthOpen(true)}>
          תיקו · תוספת זמן <span dir="ltr">+{state.settings.drawExtraMinutes}</span> דק׳ <span className="extra-edit">שינוי</span>
        </button>
      )}
      <div className="clock-ctrl">
        <button type="button" className="btn btn-primary" onClick={startStop}>
          <Icon name={running ? 'pause' : 'play'} size={20} /> {running ? 'עצירה' : elapsed > 0 ? 'המשך' : 'התחלה'}
        </button>
        {elapsed > 0 && (
          <button type="button" className="btn btn-quiet" onClick={() => set(resetClock(m))} aria-label="איפוס שעון">
            <Icon name="undo" size={20} />
          </button>
        )}
      </div>

      {lengthOpen && (
        <Sheet title="אורך המשחק" onClose={() => setLengthOpen(false)}>
          <p className="lead len-now" aria-live="polite">
            {elapsed > 0 ? `עברו ${fmt(elapsed)}` : 'המשחק עוד לא התחיל'}
            {left !== null && (over ? ' · הזמן נגמר' : ` · נשארו ${fmt(left)}`)}
          </p>
          {limitMin !== null && (
            <>
              <div className="size-pills len-pills" role="radiogroup" aria-label="דקות">
                {QUICK_MINUTES.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={limitMin === n} className={limitMin === n ? 'on' : ''} onClick={() => pickLength(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="field-row">
                <span>דקות</span>
                <Stepper label="אורך משחק בדקות" value={limitMin} min={MIN_MINUTES} max={MAX_MINUTES} onChange={pickLength} suffix="דק׳" />
              </div>
              <p className="hint small">נשמר גם למשחקים הבאים.</p>
              <p className="len-sub">תוספת זמן, רק למשחק הזה:</p>
              <div className="row-2">
                <button type="button" className="btn btn-quiet" disabled={limitMin >= MAX_MINUTES} onClick={() => set(adjustMatchLength(m, MINUTE, dflt))} aria-label="+1 דק׳">
                  <span dir="ltr">+1</span> דק׳
                </button>
                <button type="button" className="btn btn-quiet" disabled={limitMin <= MIN_MINUTES} onClick={() => set(adjustMatchLength(m, -MINUTE, dflt))} aria-label="−1 דק׳">
                  <span dir="ltr">−1</span> דק׳
                </button>
              </div>
            </>
          )}
          <Toggle
            label="בלי טיימר"
            hint="השעון סופר קדימה ולא שורק בסוף הזמן. למשחקים עד מספר גולים."
            checked={limitMin === null}
            onChange={(off) => pickLength(off ? null : state.settings.matchMinutes)}
          />
          <button type="button" className="btn btn-primary btn-block" onClick={() => setLengthOpen(false)}>
            אישור
          </button>
        </Sheet>
      )}

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
        <button type="button" className="text-btn" onClick={() => setArriving(true)}>
          <Icon name="plus" size={18} /> מישהו הגיע?
        </button>
        <button type="button" className="text-btn" onClick={() => setLeaving(true)}>
          <Icon name="leave" size={18} /> מישהו עזב?
        </button>
      </div>
      {arriving && <LateSheet onClose={() => setArriving(false)} mode={runner ? 'runner' : undefined} />}
      {leaving && <LeaveSheet onClose={() => setLeaving(false)} mode={runner ? 'runner' : undefined} />}

      <BorrowCard m={m} r={r} set={set} />

      {!runner && dom !== null && weaken && (
        <div className="notice tip">
          <p>
            {teamLook(state.settings, dom).the} {verb(teamLook(state.settings, dom), 'שולטים', 'שולטת')} ({m.streak[dom] >= 3 ? `${m.streak[dom]} ניצחונות ברצף` : 'רוב המשחקים'}). להחליף את{' '}
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
            {verb(teamLook(state.settings, nextUp), 'הבאים', 'הבאה')}: {teamLook(state.settings, nextUp).the}
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
        {runner ? (
          <button type="button" className="text-btn" onClick={runner.onRelease}>
            להפסיק לנהל
          </button>
        ) : (
          <button type="button" className="text-btn danger" onClick={() => setConfirmEnd(true)}>
            סיום הערב
          </button>
        )}
      </div>

      {scorerFor !== null && (
        <Sheet title={`מי הבקיע ${teamLook(state.settings, scorerFor).to}?`} onClose={() => setScorerFor(null)}>
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

      {drawAsk === 'pens' && (
        <Sheet title="תיקו. מי ניצחה בפנדלים?" onClose={() => setDrawAsk(false)}>
          <div className="pens-teams">
            {[a, b].map((t) => {
              const look = teamLook(state.settings, t);
              return (
                <button
                  key={t}
                  type="button"
                  className="pens-team"
                  style={{ '--team': look.color } as React.CSSProperties}
                  onClick={() => finishOnPens(t)}
                >
                  <span className="dot" aria-hidden="true" />
                  {look.the}
                </button>
              );
            })}
          </div>
          <button type="button" className="text-btn pens-none" onClick={plainDraw}>
            בלי פנדלים, תיקו
          </button>
        </Sheet>
      )}

      {drawAsk === 'leave' && (
        <Sheet title="תיקו. מי יוצא?" onClose={() => setDrawAsk(false)}>
          <p className="lead">{defaultOutOnDraw(m) !== null ? 'בדרך כלל יוצאת הקבוצה שנמצאת יותר זמן על המגרש.' : 'משחק ראשון, אז תחליטו אתם.'}</p>
          <div className="stack">
            {[a, b].map((t) => (
              <button key={t} type="button" className={`btn btn-block ${defaultOutOnDraw(m) === t ? 'btn-primary' : 'btn-quiet'}`} onClick={() => finish(t)}>
                {teamLook(state.settings, t).the} {verb(teamLook(state.settings, t), 'יוצאים', 'יוצאת')}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {confirmEnd && (
        <Sheet title="לסיים את הערב?" onClose={() => setConfirmEnd(false)}>
          <p className="lead">{hasEveningData(m, Date.now()) ? 'הסיכום נשמר בערבים הקודמים. הקבוצות נשארות.' : 'עוד לא נגמר אף משחק, אז אין מה לשמור. הקבוצות נשארות.'}</p>
          <div className="stack">
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmEnd(false);
                void endEvening();
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


import { useEffect, useMemo, useState } from 'react';
import {
  allTimeStats,
  eveningStats,
  leaders,
  nameIn,
  winPct,
  MIN_GAMES_FOR_PCT,
  type AllTimeRow,
  type EveningMatch,
  type EveningRecord,
  type EveningStats,
  type TeamRow,
} from '../state/history';
import { BIBS, type TeamLook } from '../state/model';
import { useStore } from '../state/store';
import { buildEveningShareText, copyText, nativeShare } from '../share';
import { useUi } from './App';
import { Empty, Segmented, Sheet } from './components';
import { Icon } from './icons';

// ---------- helpers ----------

function lookOf(rec: EveningRecord, t: number): TeamLook {
  const bib = BIBS.find((b) => b.id === rec.teams[t]?.bib);
  return bib ? { name: bib.name, emoji: bib.emoji, color: bib.color } : { name: `קבוצה ${t + 1}`, emoji: '⚪', color: 'var(--bib-none)' };
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', ...(sameYear ? {} : { year: '2-digit' }) });
}

const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** "א, ב ו־ג" (and "+2" beyond three names). */
function names(list: string[]): string {
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} ו${shown[shown.length - 1]}` : (shown[0] ?? '');
  return more > 0 ? `${joined} ועוד ${more}` : joined;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** The team that clearly won the evening (strictly ahead of the second). */
function championOf(table: TeamRow[]): TeamRow | null {
  const [a, b] = table;
  if (!a || a.won === 0) return null;
  if (!b) return a;
  const key = (r: TeamRow) => [r.won, r.goalsFor - r.goalsAgainst, r.goalsFor];
  const [x, y] = [key(a), key(b)];
  return x[0] > y[0] || (x[0] === y[0] && (x[1] > y[1] || (x[1] === y[1] && x[2] > y[2]))) ? a : null;
}

function useReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Counts up from 0 once, unless the phone asks for reduced motion. */
function CountUp({ value, delay = 0 }: { value: number; delay?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      t0 ||= t + delay;
      const p = Math.max(0, Math.min(1, (t - t0) / 700));
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, reduced]);
  return <>{shown}</>;
}

/** "🔴 אדומים 3 – 1 כחולים 🔵", with each score next to its team. */
function ScoreLine({ rec, m }: { rec: EveningRecord; m: EveningMatch }) {
  const A = lookOf(rec, m.a);
  const B = lookOf(rec, m.b);
  return (
    <span className="ev-score">
      <span className="ev-team">
        <span className="dot" style={{ background: A.color }} /> {A.name}
      </span>
      <span className="ev-goals">
        <b>{m.goalsA}</b>
        <span aria-hidden="true">–</span>
        <b>{m.goalsB}</b>
      </span>
      <span className="ev-team">
        {B.name} <span className="dot" style={{ background: B.color }} />
      </span>
    </span>
  );
}

interface Highlight {
  icon: string;
  title: string;
  value: React.ReactNode;
  sub?: string;
  /** Plain text for sharing. */
  text: string;
}

function highlightsOf(rec: EveningRecord, s: EveningStats): Highlight[] {
  const out: Highlight[] = [];
  const kings = leaders(s.scorers);
  if (kings.length) {
    const n = kings[0].n;
    const who = names(kings.map((k) => k.name));
    out.push({
      icon: '👑',
      title: kings.length > 1 ? 'מלכי השערים' : 'מלך השערים',
      value: who,
      sub: kings.length > 1 ? `${plural(n, 'שער אחד', 'שערים')} כל אחד` : plural(n, 'שער אחד', 'שערים'),
      text: `👑 ${kings.length > 1 ? 'מלכי השערים' : 'מלך השערים'}: ${who} (${n})`,
    });
  }
  const winners = leaders(s.playerWins);
  if (winners.length && winners.length <= 4 && winners[0].n >= 2) {
    const n = winners[0].n;
    const who = names(winners.map((w) => w.name));
    out.push({
      icon: '🏅',
      title: 'הכי הרבה ניצחונות',
      value: who,
      sub: winners.length === 1 ? `${n} ניצחונות מתוך ${winners[0].played} משחקים` : `${n} ניצחונות כל אחד`,
      text: `🏅 הכי הרבה ניצחונות: ${who} (${n})`,
    });
  }
  if (s.streak) {
    const t = lookOf(rec, s.streak.team);
    out.push({
      icon: '🔥',
      title: 'הרצף הארוך',
      value: `ה${t.name}`,
      sub: `${s.streak.wins} ניצחונות ברצף`,
      text: `🔥 הרצף הארוך: ה${t.name}, ${s.streak.wins} ניצחונות ברצף`,
    });
  }
  const line = (i: number) => {
    const m = rec.matches[i];
    return `${lookOf(rec, m.a).name} ${m.goalsA}–${m.goalsB} ${lookOf(rec, m.b).name}`;
  };
  if (s.biggestWin) {
    out.push({
      icon: '💥',
      title: 'הניצחון הגדול',
      value: <ScoreLine rec={rec} m={rec.matches[s.biggestWin.index]} />,
      sub: `משחק ${s.biggestWin.index + 1} · הפרש ${s.biggestWin.margin}`,
      text: `💥 הניצחון הגדול: ${line(s.biggestWin.index)}`,
    });
  }
  if (s.mostGoals && s.mostGoals.index !== s.biggestWin?.index) {
    out.push({
      icon: '🎯',
      title: 'המשחק הכי פתוח',
      value: <ScoreLine rec={rec} m={rec.matches[s.mostGoals.index]} />,
      sub: `משחק ${s.mostGoals.index + 1} · ${s.mostGoals.total} שערים`,
      text: `🎯 המשחק הכי פתוח: ${line(s.mostGoals.index)}`,
    });
  }
  return out;
}

// ---------- one evening ----------

export function EveningScreen({ record: rec }: { record: EveningRecord }) {
  const { dispatch } = useStore();
  const { go, notify } = useUi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = useMemo(() => eveningStats(rec), [rec]);
  const highlights = useMemo(() => highlightsOf(rec, s), [rec, s]);
  const champ = championOf(s.table);
  const champLook = champ ? lookOf(rec, champ.team) : null;

  const share = async () => {
    const text = buildEveningShareText({
      date: new Date(rec.startedAt),
      matches: s.matches,
      goals: s.goals,
      minutes: s.minutes,
      champion: champLook ? `${champLook.emoji} ה${champLook.name}` : undefined,
      table: s.table.map((r) => `${lookOf(rec, r.team).emoji} ${lookOf(rec, r.team).name}: ${r.won} נ׳ · ${r.drawn} ת׳ · ${r.lost} ה׳`),
      highlights: highlights.map((h) => h.text),
    });
    if (await nativeShare({ text })) return;
    notify((await copyText(text)) ? 'הסיכום הועתק' : 'ההעתקה נכשלה');
  };

  const stats: [number, string][] = [
    [s.matches, s.matches === 1 ? 'משחק' : 'משחקים'],
    [s.goals, s.goals === 1 ? 'שער' : 'שערים'],
    ...(s.minutes ? ([[s.minutes, 'דקות']] as [number, string][]) : []),
  ];

  return (
    <section className="evening" aria-labelledby="ev-h">
      <div className="ev-hero" style={champLook ? ({ '--team': champLook.color } as React.CSSProperties) : undefined}>
        <p className="ev-date">
          {dateLabel(rec.startedAt)} · {timeLabel(rec.startedAt)}
          {timeLabel(rec.endedAt) !== timeLabel(rec.startedAt) && `–${timeLabel(rec.endedAt)}`}
        </p>
        <h1 id="ev-h">{champLook ? `ה${champLook.name} לקחו את הערב` : 'ערב צמוד, בלי מנצח ברור'}</h1>
        {champ && (
          <p className="ev-champ-sub">
            {[
              plural(champ.won, 'ניצחון אחד', 'ניצחונות'),
              champ.drawn ? plural(champ.drawn, 'תיקו אחד', 'תיקו') : '',
              champ.lost ? plural(champ.lost, 'הפסד אחד', 'הפסדים') : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      <dl className="ev-stats">
        {stats.map(([n, label], i) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <CountUp value={n} delay={i * 120} />
            </dd>
          </div>
        ))}
      </dl>

      {highlights.length > 0 && (
        <ul className="ev-highlights">
          {highlights.map((h, i) => (
            <li key={h.title} style={{ '--i': i } as React.CSSProperties}>
              <span className="ev-icon" aria-hidden="true">
                {h.icon}
              </span>
              <span className="ev-hl-text">
                <small>{h.title}</small>
                <strong>{h.value}</strong>
                {h.sub && <span className="muted">{h.sub}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="ev-h2">הטבלה</h2>
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
            {s.table.map((row) => (
              <tr key={row.team}>
                <th scope="row">
                  <span className="dot" style={{ background: lookOf(rec, row.team).color }} /> {lookOf(rec, row.team).name}
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
      {s.scorers.length > 0 && <p className="scorers">⚽ {s.scorers.map((x) => `${x.name} ${x.n}`).join(' · ')}</p>}

      <details className="fold">
        <summary>כל המשחקים ({rec.matches.length})</summary>
        <ol className="ev-matches">
          {rec.matches.map((m, i) => {
            const by = m.goals.filter((g) => g.by).map((g) => nameIn(rec, g.by!));
            return (
              <li key={i}>
                <span className="ev-no">{i + 1}</span>
                <span className="ev-match-body">
                  <ScoreLine rec={rec} m={m} />
                  {by.length > 0 && <small className="muted">⚽ {by.join(', ')}</small>}
                </span>
              </li>
            );
          })}
        </ol>
      </details>

      <details className="fold">
        <summary>הקבוצות</summary>
        <ul className="ev-rosters">
          {rec.teams.map((t, i) =>
            t.ids.length ? (
              <li key={i}>
                <span className="dot" style={{ background: lookOf(rec, i).color }} /> <strong>{lookOf(rec, i).name}:</strong>{' '}
                {t.ids.map((id) => nameIn(rec, id)).join(', ')}
              </li>
            ) : null,
          )}
          {rec.subIds.length > 0 && (
            <li>
              <strong>מחליפים:</strong> {rec.subIds.map((id) => nameIn(rec, id)).join(', ')}
            </li>
          )}
        </ul>
      </details>

      <div className="dock">
        <button type="button" className="btn btn-quiet btn-block" onClick={share}>
          <Icon name="share" size={20} /> שיתוף הסיכום
        </button>
      </div>
      <div className="row-links">
        <button type="button" className="text-btn danger" onClick={() => setConfirmDelete(true)}>
          מחיקה מההיסטוריה
        </button>
      </div>

      {confirmDelete && (
        <Sheet title="למחוק את הערב?" onClose={() => setConfirmDelete(false)}>
          <p className="lead">הסיכום של הערב הזה יימחק מהטלפון. השחקנים לא נפגעים.</p>
          <div className="stack">
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                dispatch({ type: 'deleteEvening', id: rec.id });
                go('history');
                notify('הערב נמחק');
              }}
            >
              מחיקה
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => setConfirmDelete(false)}>
              ביטול
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

// ---------- the list and all-time ----------

function EveningRow({ rec }: { rec: EveningRecord }) {
  const { go } = useUi();
  const s = eveningStats(rec);
  const champ = championOf(s.table);
  const king = leaders(s.scorers);
  return (
    <li>
      <button type="button" onClick={() => go('evening', rec.id)}>
        <span className="ev-row-dot" style={{ background: champ ? lookOf(rec, champ.team).color : 'var(--sunk)' }} aria-hidden="true" />
        <span className="ev-row-text">
          <span className="name">{dateLabel(rec.startedAt)}</span>
          <small className="muted">
            {plural(s.matches, 'משחק אחד', 'משחקים')} · {plural(s.goals, 'שער אחד', 'שערים')} · {plural(rec.players.length, 'שחקן אחד', 'שחקנים')}
            {champ && ` · 🏆 ${lookOf(rec, champ.team).name}`}
            {king.length === 1 && ` · 👑 ${king[0].name}`}
          </small>
        </span>
        <span className="ev-chev" aria-hidden="true">
          <Icon name="back" size={18} />
        </span>
      </button>
    </li>
  );
}

function Board({ title, rows, value }: { title: string; rows: AllTimeRow[]; value: (r: AllTimeRow) => string }) {
  if (!rows.length) return null;
  // Ties share a place: 1, 2, 2, 4.
  const ranks = rows.map((r, i) => (i > 0 && value(r) === value(rows[i - 1]) ? -1 : i + 1));
  ranks.forEach((n, i) => n === -1 && (ranks[i] = ranks[i - 1]));
  return (
    <div className="board">
      <h2 className="ev-h2">{title}</h2>
      <ol>
        {rows.map((r, i) => (
          <li key={r.key}>
            <span className={`ev-no ${ranks[i] === 1 ? 'first' : ''}`}>{ranks[i]}</span>
            <span className="name">{r.name}</span>
            <span className="board-val">{value(r)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AllTimeView({ history }: { history: EveningRecord[] }) {
  const { state } = useStore();
  const t = useMemo(() => allTimeStats(history, state.players), [history, state.players]);
  const top = (cmp: (a: AllTimeRow, b: AllTimeRow) => number, keep: (r: AllTimeRow) => boolean) =>
    t.rows.filter(keep).sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'he')).slice(0, 5);
  const scorers = top((a, b) => b.goals - a.goals, (r) => r.goals > 0);
  const pct = top((a, b) => winPct(b)! - winPct(a)! || b.played - a.played, (r) => winPct(r) !== null);
  const regulars = top((a, b) => b.evenings - a.evenings || b.played - a.played, () => true);
  // Everyone came every time: nothing to rank.
  const allCame = t.rows.every((r) => r.evenings === t.evenings);
  return (
    <>
      <dl className="ev-stats">
        {(
          [
            [t.evenings, 'ערבים'],
            [t.matches, 'משחקים'],
            [t.goals, 'שערים'],
          ] as [number, string][]
        ).map(([n, label]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <Board title="👑 מלכי השערים" rows={scorers} value={(r) => plural(r.goals, 'שער אחד', 'שערים')} />
      <Board title="🏅 אחוז ניצחונות" rows={pct} value={(r) => `${winPct(r)}% · ${r.played} משחקים`} />
      {!pct.length && <p className="hint">אחוז ניצחונות יופיע אחרי {MIN_GAMES_FOR_PCT} משחקים לשחקן.</p>}
      <Board title="📅 הכי הרבה ערבים" rows={allCame ? [] : regulars} value={(r) => plural(r.evenings, 'ערב אחד', 'ערבים')} />
    </>
  );
}

export function HistoryScreen() {
  const { state } = useStore();
  const { go } = useUi();
  const [view, setView] = useState<'list' | 'all'>('list');
  const history = state.history;

  if (!history.length) {
    return (
      <Empty icon="📅" title="עוד אין ערבים">
        <p>בסוף ערב משחקים לוחצים ״סיום הערב״, והסיכום נשמר כאן: תוצאות, מבקיעים ומי ניצח הכי הרבה.</p>
        <div className="stack narrow">
          <button type="button" className="btn btn-primary btn-block" onClick={() => go('home')}>
            למסך הראשי
          </button>
        </div>
      </Empty>
    );
  }

  return (
    <section className="history" aria-label="ערבים קודמים">
      <Segmented
        label="תצוגה"
        value={view}
        onChange={setView}
        options={[
          { value: 'list', label: 'ערבים' },
          { value: 'all', label: 'כל הזמנים' },
        ]}
      />
      {view === 'list' ? (
        <ul className="ev-list">
          {history.map((rec) => (
            <EveningRow key={rec.id} rec={rec} />
          ))}
        </ul>
      ) : (
        <AllTimeView history={history} />
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ATTR_KEYS, evaluate } from '../engine';
import { ATTR_LABELS, goalsEvery } from '../i18n';
import { startSession } from '../match/match';
import { FIELD_POSITIONS } from '../state/positions';
import { engineOptions, teamLook, type AppState, type GameResult, type Player } from '../state/model';
import { isResultStale, useStore } from '../state/store';
import { buildShareText, copyText, downloadBlob, shareFile, TEAMS_TITLE, type ShareTeam } from '../share';
import { teamsImage, type ImageTeam } from '../shareImage';
import { useUi } from './App';
import { CardBadges, Empty, ScoreMeter } from './components';
import { Icon } from './icons';
import { LateSheet } from './LateSheet';
import { LeaveSheet } from './LeaveSheet';
import { rerollTeams, splitTeams } from './split';

type Sel = { kind: 'team'; i: number } | { kind: 'sub'; id: string } | null;

/** "🛡️2 🔄1 ⚡2": how many of a team's players are strong in each field position (a player can count twice). */
function PositionLine({ members }: { members: Player[] }) {
  const counts = FIELD_POSITIONS.map((x) => ({ ...x, n: members.filter((p) => p.positions?.includes(x.id)).length }));
  return (
    <span className="team-pos" aria-label={counts.map((c) => `${c.name} ${c.n}`).join(', ')}>
      {counts.map((c) => (
        <span key={c.id} aria-hidden="true" className={c.n ? '' : 'none'}>
          {c.emoji}
          {c.n}
        </span>
      ))}
    </span>
  );
}

function teamCounts(r: GameResult): number[] {
  const c = new Array<number>(r.numTeams).fill(0);
  r.assignment.forEach((t) => c[t]++);
  return c;
}

/** Live evaluation of a result against current ratings and settings. */
export function evaluateResult(state: AppState, r: GameResult, assignment = r.assignment) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const players = r.playerIds.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  if (players.length !== r.playerIds.length) return null;
  const counts = new Array<number>(r.numTeams).fill(0);
  assignment.forEach((t) => counts[t]++);
  return {
    players,
    ev: evaluate(players, assignment, r.numTeams, engineOptions(state.settings), state.constraints, [...counts].sort((a, b) => b - a)),
  };
}

/** Names only, keeper first, for the picture and the short text. */
export function shareData(state: AppState, r: GameResult): { teams: (ShareTeam & ImageTeam)[]; subs: string[] } {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const indexOf = new Map(r.playerIds.map((id, i) => [id, i]));
  const rotate = state.settings.gkMode === 'rotate';
  const name = (id: string) => byId.get(id)?.name ?? '?';
  return {
    teams: Array.from({ length: r.numTeams }, (_, t) => {
      const look = teamLook(state.settings, t);
      const order = (r.gkOrder[t]?.length ? r.gkOrder[t] : r.playerIds.filter((_, i) => r.assignment[i] === t)).filter(
        (id) => r.assignment[indexOf.get(id) ?? -1] === t,
      );
      return {
        name: look.name,
        emoji: look.emoji,
        color: look.color,
        sub: t < 2 ? undefined : r.numTeams === 3 ? 'בחוץ' : `בתור #${t - 1}`,
        names: order.map(name),
        keeper: order.length > 0 && (rotate || !!byId.get(order[0])?.canGK),
      };
    }),
    subs: r.subIds.map(name),
  };
}

const pngOf = (d: ReturnType<typeof shareData>) => teamsImage(d).then((b) => (b ? new File([b], 'kochot.png', { type: 'image/png' }) : null));

export function TeamsScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const r = state.result;
  const data = useMemo(() => (r ? evaluateResult(state, r) : null), [state, r]);
  const shared = useMemo(() => (r ? shareData(state, r) : null), [state, r]);
  const sharedKey = JSON.stringify(shared);
  // Drawn ahead, so the tap opens the share sheet right away (iOS wants it inside the tap).
  const png = useRef<{ key: string; file: Promise<File | null> } | null>(null);
  useEffect(() => {
    if (!shared) return;
    const t = setTimeout(() => {
      png.current = { key: sharedKey, file: pngOf(shared) };
    }, 300);
    return () => clearTimeout(t);
  }, [sharedKey]);

  if (!r || !data) {
    return (
      <Empty icon="🎽" title="עוד לא חולקו קבוצות">
        <button type="button" className="btn btn-primary" onClick={() => go('home')}>
          למסך הראשי
        </button>
      </Empty>
    );
  }

  const { players, ev } = data;
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const k = r.numTeams;
  const counts = teamCounts(r);
  const indexOf = new Map(r.playerIds.map((id, i) => [id, i]));
  // Only when someone in the split has a field position; otherwise the line would be all zeros.
  const showPositions = players.some((p) => p.positions?.length);
  const stale = isResultStale(state);
  const edited = r.assignment.some((t, i) => t !== r.generated[i]);
  const animKey = `${r.createdAt}-${r.shown.length}`;
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const rotate = state.settings.gkMode === 'rotate';

  const tapMember = (i: number) => {
    if (sel?.kind === 'sub') {
      const a = nameOf(sel.id);
      dispatch({ type: 'swapSub', subId: sel.id, i });
      setSel(null);
      return notify(`${a} נכנס במקום ${players[i].name}`);
    }
    if (!sel) return setSel({ kind: 'team', i });
    if (sel.i === i) return setSel(null);
    if (r.assignment[sel.i] === r.assignment[i]) return setSel({ kind: 'team', i });
    dispatch({ type: 'swap', i: sel.i, j: i });
    notify(`${players[sel.i].name} ⇄ ${players[i].name}`);
    setSel(null);
  };
  const tapSub = (id: string) => {
    if (sel?.kind === 'team') {
      const out = players[sel.i].name;
      dispatch({ type: 'swapSub', subId: id, i: sel.i });
      setSel(null);
      return notify(`${nameOf(id)} נכנס במקום ${out}`);
    }
    setSel(sel?.kind === 'sub' && sel.id === id ? null : { kind: 'sub', id });
  };

  const reroll = async () => {
    setSel(null);
    setBusy(true);
    try {
      if ((await rerollTeams(state, dispatch)) === 'none') notify('אין חלוקה אחרת מאוזנת באותה מידה');
    } finally {
      setBusy(false);
    }
  };

  const resplit = async () => {
    setBusy(true);
    try {
      if (!(await splitTeams(state, dispatch))) go('home');
      setSel(null);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const d = shared!;
    if (png.current?.key !== sharedKey) png.current = { key: sharedKey, file: pngOf(d) };
    const file = await png.current.file;
    if (file && (await shareFile(file, TEAMS_TITLE)) === 'shared') return;
    // Desktop / no file sharing: save the picture and copy the short text.
    if (file) downloadBlob('kochot.png', file);
    const copied = await copyText(buildShareText(d));
    notify(file ? (copied ? 'התמונה נשמרה והטקסט הועתק' : 'התמונה נשמרה') : copied ? 'הטקסט הועתק' : 'השיתוף לא זמין כאן');
  };

  const startMatch = () => {
    if (!state.match) dispatch({ type: 'setMatch', match: startSession(k), now: Date.now() });
    go('match');
  };

  const violations = [
    ...ev.violations.together.map(([a, b]) => `${nameOf(a)} ו${nameOf(b)} אמורים להיות באותה קבוצה`),
    ...ev.violations.apart.map(([a, b]) => `${nameOf(a)} ו${nameOf(b)} אמורים להיות בקבוצות שונות`),
    ...(ev.penalties.goalkeeper > 0 ? ['יש קבוצה בלי שחקן שטוב בשער, למרות שיש מספיק'] : []),
  ];

  return (
    <section className="teams" aria-label="הקבוצות">
      {stale && (
        <div className="notice">
          <span>הנוכחות או גודל הקבוצה השתנו מאז החלוקה.</span>
          <button type="button" className="btn btn-small" disabled={busy} onClick={resplit}>
            חלוקה מחדש
          </button>
        </div>
      )}

      <ScoreMeter score={ev.score} animateKey={animKey} onHelp={() => go('help', 'score')} />

      {violations.length > 0 && (
        <ul className="notice list" role="status">
          {violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}

      <p className="hint center" aria-live="polite">
        {sel === null
          ? 'רוצים לשנות? נוגעים בשחקן ואז בשחקן מקבוצה אחרת'
          : sel.kind === 'team'
            ? `${players[sel.i].name} נבחר · עכשיו שחקן מקבוצה אחרת`
            : `${nameOf(sel.id)} נבחר · במקום מי הוא נכנס?`}
      </p>

      <div className="team-grid" key={animKey}>
        {Array.from({ length: k }, (_, t) => {
          const look = teamLook(state.settings, t);
          const order = (r.gkOrder[t]?.length ? r.gkOrder[t] : r.playerIds.filter((_, i) => r.assignment[i] === t)).filter(
            (id) => r.assignment[indexOf.get(id) ?? -1] === t,
          );
          // With a queue, any short team (the one outside, or one that lost a player) borrows from the loser.
          const short = counts[t] < r.teamSize && k > 2;
          return (
            <article key={t} className={`team ${t >= 2 ? 'waiting' : ''}`} style={{ '--team': look.color } as React.CSSProperties} aria-label={look.the}>
              <header>
                <h2>{look.name}</h2>
                <span className="team-sub">
                  {t < 2 ? 'פותחים' : `בתור #${t - 1}`}
                  {short && ` · משלימים ${r.teamSize - counts[t]}`}
                </span>
                {showPositions && <PositionLine members={order.map((id) => byId.get(id)!).filter(Boolean)} />}
              </header>
              <ol>
                {order.map((id, slot) => {
                  const i = indexOf.get(id)!;
                  const p = byId.get(id)!;
                  const isSel = sel?.kind === 'team' && sel.i === i;
                  const isTarget = sel !== null && !(sel.kind === 'team' && r.assignment[sel.i] === t);
                  return (
                    <li key={id} style={{ '--i': slot + t * 2 } as React.CSSProperties}>
                      <button type="button" className={`member ${isSel ? 'sel' : ''} ${isTarget ? 'target' : ''}`} aria-pressed={isSel} onClick={() => tapMember(i)}>
                        <span className="slot" aria-label={slot === 0 ? 'מתחיל בשער' : undefined}>
                          {slot === 0 && (rotate || p.canGK) ? '🧤' : rotate ? slot + 1 : ''}
                        </span>
                        <span className="name">{p.name}</span>
                        <CardBadges cards={p.cards} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </div>
      <p className="hint center small">
        {rotate ? `🧤 סדר השוערים לפי המספרים · מתחלפים ${goalsEvery(state.settings.gkSwitchGoals)}` : '🧤 השוער הקבוע של כל קבוצה'}
      </p>

      {r.subIds.length > 0 && (
        <div className="bench">
          <span className="label">מחליפים</span>
          {r.subIds.map((id) => (
            <button key={id} type="button" className={`member chip ${sel?.kind === 'sub' && sel.id === id ? 'sel' : ''}`} onClick={() => tapSub(id)}>
              {nameOf(id)}
            </button>
          ))}
          {sel === null && <p className="hint small bench-hint">להכנסה: נוגעים במחליף ואז בשחקן שיוצא</p>}
        </div>
      )}

      <div className="dock">
        <button type="button" className="btn btn-hero btn-block" onClick={startMatch}>
          <Icon name="timer" /> {state.match ? 'חזרה למשחק' : 'התחלת משחק'}
        </button>
        <div className="row-2">
          <button type="button" className="btn btn-wa" onClick={share}>
            <Icon name="share" size={20} /> שיתוף
          </button>
          <button type="button" className="btn btn-quiet" onClick={reroll} disabled={busy}>
            <Icon name="dice" size={20} /> הגרלה מחדש
          </button>
        </div>
        <div className="row-links">
          <button type="button" className="text-btn" onClick={() => setLate(true)}>
            <Icon name="plus" size={18} /> הגיע מאוחר
          </button>
          <button type="button" className="text-btn" onClick={() => setLeaving(true)}>
            <Icon name="leave" size={18} /> עזב באמצע
          </button>
          {edited && (
            <button type="button" className="text-btn" onClick={() => dispatch({ type: 'resetSwaps' })}>
              <Icon name="undo" size={18} /> ביטול החלפות
            </button>
          )}
        </div>
      </div>

      <details className="fold">
        <summary>פירוט האיזון</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">ממוצע</th>
                {Array.from({ length: k }, (_, t) => (
                  <th scope="col" key={t}>
                    {teamLook(state.settings, t).name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ATTR_KEYS.map((a) => (
                <tr key={a}>
                  <th scope="row">{ATTR_LABELS[a]}</th>
                  {ev.teams.map((s, t) => (
                    <td key={t}>{s.size ? (s.totals[a] / s.size).toFixed(1) : '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint small">משווים ממוצע לשחקן, כדי שקבוצה קצרה שמשלימה מהמפסידה תהיה הוגנת.</p>
      </details>

      {leaving && (
        <LeaveSheet
          onClose={() => {
            setLeaving(false);
            setSel(null);
          }}
        />
      )}
      {late && (
        <LateSheet
          onClose={() => {
            setLate(false);
            setSel(null);
          }}
        />
      )}
    </section>
  );
}

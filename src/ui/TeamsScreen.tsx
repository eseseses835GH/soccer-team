import { useMemo, useState } from 'react';
import { ATTR_KEYS, evaluate, randomSeed, scoreFromCost, suggestSwaps, type SwapSuggestion } from '../engine';
import { ATTR_LABELS, goalsEvery } from '../i18n';
import { startSession } from '../match/match';
import { applyCards } from '../state/cards';
import { FIELD_POSITIONS } from '../state/positions';
import { lateJoin } from '../state/late';
import { engineOptions, newId, teamLook, type AppState, type GameResult, type Player } from '../state/model';
import { isResultStale, useStore } from '../state/store';
import { buildShareText, copyText, nativeShare, whatsappUrl } from '../share';
import { useUi } from './App';
import { CardBadges, Empty, LevelPicker, ScoreMeter, Sheet } from './components';
import { Icon } from './icons';
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

export function teamsForShare(state: AppState, r: GameResult, score: number) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const counts = teamCounts(r);
  const name = (id: string) => byId.get(id)?.name ?? '?';
  return buildShareText({
    teams: Array.from({ length: r.numTeams }, (_, t) => {
      const look = teamLook(state.settings, t);
      const order = r.gkOrder[t]?.length ? r.gkOrder[t] : r.playerIds.filter((_, i) => r.assignment[i] === t);
      return {
        name: look.name,
        emoji: look.emoji,
        names: order.map(name),
        keepers: order.map(name),
        borrows: t >= 2 && counts[t] < r.teamSize ? r.teamSize - counts[t] : 0,
      };
    }),
    subs: r.subIds.map(name),
    score,
    gkSwitchGoals: state.settings.gkMode === 'rotate' ? state.settings.gkSwitchGoals : undefined,
  });
}

export function TeamsScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState(false);
  const [late, setLate] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [suggestion, setSuggestion] = useState<SwapSuggestion | null>(null);
  const r = state.result;
  const data = useMemo(() => (r ? evaluateResult(state, r) : null), [state, r]);

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

  const text = () => teamsForShare(state, r, ev.score);
  const share = async () => {
    const t = text();
    if (await nativeShare({ text: t })) return;
    if (window.open(whatsappUrl(t), '_blank', 'noopener')) return;
    // Pop-ups blocked (some in-app browsers): copy instead.
    notify((await copyText(t)) ? 'הטקסט הועתק, מדביקים בוואטסאפ' : 'השיתוף לא זמין כאן');
  };
  const copy = async () => notify((await copyText(text())) ? 'הועתק' : 'ההעתקה נכשלה');

  const startMatch = () => {
    if (!state.match) dispatch({ type: 'setMatch', match: startSession(k), now: Date.now() });
    go('match');
  };

  const onLate = (player: Player, isNew: boolean) => {
    const j = lateJoin(r, player.id, randomSeed());
    dispatch({ type: 'lateJoin', player: isNew ? player : undefined, id: player.id, result: j.result, now: Date.now() });
    setLate(false);
    const look = j.team !== null ? teamLook(state.settings, j.team) : null;
    if (j.outcome === 'bench') notify(`${player.name} מחכה בחוץ כמחליף`);
    else if (j.outcome === 'newTeam') notify(`נפתחה קבוצה חדשה: ${look!.the}`);
    else if (j.outcome === 'waiting') notify(`${player.name} הצטרף ${look!.to}`);
    else {
      notify(`${player.name} השלים את ${look!.the}`);
      const roster = isNew ? [...state.players, player] : state.players;
      const map = new Map(roster.map((p) => [p.id, p]));
      const ps = j.result.playerIds.map((id) => map.get(id)!);
      const c = new Array<number>(j.result.numTeams).fill(0);
      j.result.assignment.forEach((t) => c[t]++);
      const s = suggestSwaps(ps, j.result.assignment, j.result.numTeams, engineOptions(state.settings), state.constraints, c.sort((a, b) => b - a));
      if (s) setSuggestion(s);
    }
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
          <button type="button" className="text-btn" onClick={copy}>
            <Icon name="copy" size={18} /> העתקה
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
      {late && <LateSheet onClose={() => setLate(false)} onPick={onLate} />}
      {suggestion && (
        <SuggestSheet
          suggestion={suggestion}
          names={r.playerIds}
          nameOf={nameOf}
          onClose={() => setSuggestion(null)}
          onApply={() => {
            dispatch({ type: 'applyAssignment', assignment: suggestion.assignment, swaps: suggestion.swaps });
            setSuggestion(null);
            notify('בוצע');
          }}
        />
      )}
    </section>
  );
}

function LateSheet({ onClose, onPick }: { onClose: () => void; onPick: (p: Player, isNew: boolean) => void }) {
  const { state } = useStore();
  const [name, setName] = useState('');
  const [level, setLevel] = useState(5);
  const inGame = new Set([...(state.result?.playerIds ?? []), ...(state.result?.subIds ?? [])]);
  const others = state.players.filter((p) => !inGame.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const taken = state.players.some((p) => p.name.trim() === name.trim());
  return (
    <Sheet title="מי הגיע?" onClose={onClose}>
      <p className="lead">הוא מצטרף לקבוצה שבחוץ או מחכה כמחליף. לא מערבבים את כולם מחדש.</p>
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
          הצטרף
        </button>
      </form>
    </Sheet>
  );
}

function SuggestSheet({
  suggestion,
  names,
  nameOf,
  onClose,
  onApply,
}: {
  suggestion: SwapSuggestion;
  names: string[];
  nameOf: (id: string) => string;
  onClose: () => void;
  onApply: () => void;
}) {
  const before = scoreFromCost(suggestion.before);
  const after = scoreFromCost(suggestion.after);
  return (
    <Sheet title="הקבוצה שבחוץ התמלאה" onClose={onClose}>
      <p className="lead">
        אפשר לשפר את האיזון מ-<strong>{before}</strong> ל-<strong>{after}</strong> עם {suggestion.swaps.length === 1 ? 'החלפה אחת' : 'שתי החלפות'}:
      </p>
      <ul className="swap-list">
        {suggestion.swaps.map(([i, j]) => (
          <li key={`${i}-${j}`}>
            {nameOf(names[i])} ⇄ {nameOf(names[j])}
          </li>
        ))}
      </ul>
      <div className="stack">
        <button type="button" className="btn btn-primary btn-block" onClick={onApply}>
          להחליף
        </button>
        <button type="button" className="btn btn-quiet btn-block" onClick={onClose}>
          להשאיר ככה
        </button>
      </div>
    </Sheet>
  );
}

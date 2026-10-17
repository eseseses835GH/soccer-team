import { useMemo, useState } from 'react';
import { ATTR_KEYS, createRng, evaluate, pickReroll, randomSeed, type Player } from '../engine';
import { ATTR_SHORT, TEAMS, playersCount } from '../i18n';
import { engineOptions } from '../state/model';
import { isResultStale, presentPlayers, useStore } from '../state/store';
import { buildShareText, copyText, nativeShare, whatsappUrl } from '../share';
import { balance } from '../worker/balancer';
import { useUi } from './App';
import { EmptyState, ScoreMeter } from './components';
import { Icon } from './icons';

export function TeamsScreen() {
  const { state, dispatch } = useStore();
  const { go, notify } = useUi();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const result = state.result;

  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const players = useMemo(
    () => (result ? result.playerIds.map((id) => byId.get(id)).filter((p): p is Player => !!p) : []),
    [result, byId],
  );
  const options = engineOptions(state.settings);
  const ev = useMemo(
    () =>
      result && players.length === result.playerIds.length
        ? evaluate(players, result.assignment, result.numTeams, options, state.constraints)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, players, state.settings, state.constraints],
  );

  if (!result || !ev) {
    return (
      <EmptyState icon="🎽" title="עוד לא חולקו קבוצות">
        <p>מסמנים מי הגיע ולוחצים על ״חלוקה לקבוצות״.</p>
        <button type="button" className="btn btn-primary" onClick={() => go('game')}>
          למסך המשחק
        </button>
      </EmptyState>
    );
  }

  const k = result.numTeams;
  const teams = Array.from({ length: k }, (_, t) =>
    result.assignment
      .map((team, i) => ({ team, i }))
      .filter((x) => x.team === t)
      .map((x) => ({ i: x.i, p: players[x.i] }))
      .sort((a, b) => b.p.attrs.overall - a.p.attrs.overall),
  );
  const weightSum = ATTR_KEYS.reduce((s, a) => s + options.weights[a], 0) || 1;
  const stale = isResultStale(state);
  const edited = result.assignment.some((t, i) => t !== result.generated[i]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';

  const tap = (i: number) => {
    if (selected === null) return setSelected(i);
    if (selected === i) return setSelected(null);
    if (result.assignment[selected] === result.assignment[i]) return setSelected(i);
    const a = players[selected].name;
    const b = players[i].name;
    dispatch({ type: 'swap', i: selected, j: i });
    setSelected(null);
    notify(`${a} ⇄ ${b}`);
  };

  const reroll = () => {
    setSelected(null);
    if (result.pool.length < 2) return notify('אין חלוקה אחרת מאוזנת באותה מידה');
    const next = pickReroll(result.pool, result.shown, createRng(randomSeed()));
    dispatch({ type: 'showSolution', assignment: next.assignment });
  };

  const regenerate = async () => {
    const present = presentPlayers(state);
    if (present.length < state.numTeams * 2) return go('game');
    setBusy(true);
    try {
      const res = await balance({ players: present, k: state.numTeams, options, constraints: state.constraints, seed: randomSeed() });
      dispatch({ type: 'setResult', playerIds: present.map((p) => p.id), numTeams: state.numTeams, best: res.best, pool: res.pool });
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const shareText = () => buildShareText(teams.map((t) => ({ names: t.map((x) => x.p.name) })), ev.score);
  const share = async () => {
    const text = shareText();
    if (await nativeShare(text)) return;
    window.open(whatsappUrl(text), '_blank', 'noopener');
  };
  const copy = async () => notify((await copyText(shareText())) ? 'הועתק ✔' : 'ההעתקה נכשלה');

  const unavoidableGK = ev.teams.filter((t) => t.goalkeepers === 0).length;

  return (
    <section aria-labelledby="teams-h">
      <div className="section-head">
        <h2 id="teams-h">הקבוצות</h2>
        <span className="muted">{playersCount(players.length)}</span>
      </div>

      {stale && (
        <div className="banner" role="status">
          <span>הנוכחות או מספר הקבוצות השתנו מאז החלוקה.</span>
          <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={regenerate}>
            חלוקה מחדש
          </button>
        </div>
      )}

      <ScoreMeter score={ev.score} />

      {(ev.violations.together.length > 0 || ev.violations.apart.length > 0 || ev.penalties.goalkeeper > 0 || ev.penalties.leadership > 0) && (
        <ul className="warnings" role="status">
          {ev.violations.together.map(([a, b]) => (
            <li key={`t${a}${b}`}>
              ⚠️ {nameOf(a)} ו{nameOf(b)} אמורים לשחק יחד
            </li>
          ))}
          {ev.violations.apart.map(([a, b]) => (
            <li key={`a${a}${b}`}>
              ⚠️ {nameOf(a)} ו{nameOf(b)} אמורים להיות בנפרד
            </li>
          ))}
          {ev.penalties.goalkeeper > 0 && <li>⚠️ יש קבוצה בלי שוער, למרות שיש מספיק שוערים</li>}
          {ev.penalties.leadership > 0 && <li>⚠️ יש קבוצה בלי מנהיג, למרות שיש מספיק</li>}
        </ul>
      )}

      <p className="hint swap-hint">
        {selected === null ? 'להחלפה: נוגעים בשחקן, ואז בשחקן מקבוצה אחרת.' : `נבחר: ${players[selected].name} · בחרו שחקן מקבוצה אחרת`}
      </p>

      <div className={`teams-grid teams-${k}`}>
        {teams.map((members, t) => {
          const look = TEAMS[t];
          const st = ev.teams[t];
          const avg = st.size ? st.strength / (st.size * weightSum) : 0;
          return (
            <article key={t} className={`team-card ${look.cls}`} aria-label={`קבוצת ה${look.name}`}>
              <header>
                <h3>
                  <span className="team-dot" aria-hidden="true" />
                  {look.name}
                </h3>
                <span className="team-meta">
                  {st.size} · ממוצע {avg.toFixed(1)}
                </span>
              </header>
              <ul>
                {members.map(({ i, p }) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`member ${selected === i ? 'selected' : ''} ${
                        selected !== null && result.assignment[selected] !== t ? 'target' : ''
                      }`}
                      aria-pressed={selected === i}
                      onClick={() => tap(i)}
                    >
                      <span className="player-name">{p.name}</span>
                      {p.canGK && (
                        <span className="mini" title="שוער">
                          🧤
                        </span>
                      )}
                      {p.attrs.leadership >= options.leadershipThreshold && (
                        <span className="mini" title="מנהיג">
                          ©️
                        </span>
                      )}
                      <span className="rating-badge small">{p.attrs.overall}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={reroll}>
          <Icon name="dice" /> הגרלה מחדש
        </button>
        <button type="button" className="btn btn-whatsapp btn-big" onClick={share}>
          <Icon name="share" /> שיתוף
        </button>
        <a className="btn btn-secondary" href={whatsappUrl(shareText())} target="_blank" rel="noopener noreferrer">
          וואטסאפ
        </a>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          <Icon name="copy" size={18} /> העתקה
        </button>
        {edited && (
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'resetSwaps' })}>
            <Icon name="undo" size={18} /> ביטול החלפות
          </button>
        )}
      </div>

      <details className="card totals">
        <summary>השוואת תכונות (סכומים)</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">תכונה</th>
                {teams.map((_, t) => (
                  <th scope="col" key={t}>
                    {TEAMS[t].emoji} {TEAMS[t].name}
                  </th>
                ))}
                <th scope="col">פער</th>
              </tr>
            </thead>
            <tbody>
              {ATTR_KEYS.map((a) => {
                const vals = ev.teams.map((s) => (a === 'goalkeeping' ? s.bestKeeper : s.totals[a]));
                const gap = Math.max(...vals) - Math.min(...vals);
                return (
                  <tr key={a}>
                    <th scope="row">{ATTR_SHORT[a]}</th>
                    {vals.map((v, t) => (
                      <td key={t}>{v}</td>
                    ))}
                    <td className="gap">{gap}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row">שוערים</th>
                {ev.teams.map((s, t) => (
                  <td key={t}>{s.goalkeepers}</td>
                ))}
                <td />
              </tr>
              <tr>
                <th scope="row">מנהיגים</th>
                {ev.teams.map((s, t) => (
                  <td key={t}>{s.leaders}</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">* בשורת ״שוער״ מוצג דירוג השוער הטוב בכל קבוצה, כי רק אחד עומד בשער.</p>
        {unavoidableGK > 0 && ev.penalties.goalkeeper === 0 && <p className="hint">אין מספיק שוערים לכל הקבוצות.</p>}
      </details>
    </section>
  );
}

// A player's main screen (read-only): tonight's evening live, a rating card when allowed, and
// "who are you?" the first time. DECISIONS → "Players and live evening — player side (v10)".
import { useEffect, useState } from 'react';
import { bibLook, verb, type TeamLook } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { liveClockMs, type LiveData } from '../sync/live';
import { claimChoices, clockText, liveName, liveNow, rateCard } from '../sync/playerGroup';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { useSync } from '../sync/SyncProvider';
import { loadJSON, saveJSON } from '../state/storage';
import { useUi } from './App';
import { Empty, PositionBadges } from './components';
import type { PublicPlayer } from '../sync/players';

const laterKey = (gid: string) => `kochot:claim-later:${gid}`;

export function PlayerHome() {
  const pg = usePlayerGroup();
  const sync = useSync();
  const { current } = useGroups();
  const { go } = useUi();
  const [later, setLater] = useState(() => loadJSON<boolean>(laterKey(current.id)) === true);
  useEffect(() => setLater(loadJSON<boolean>(laterKey(current.id)) === true), [current.id]);
  const now = useNow(1000);

  if (pg.load === 'signedOut') {
    return (
      <Empty icon="🔒" title="צריך להתחבר">
        <div className="stack narrow">
          <button type="button" className="btn btn-primary btn-block" onClick={() => sync.openLogin('account')}>
            התחברות
          </button>
        </div>
      </Empty>
    );
  }
  if (pg.load === 'denied') return <Empty icon="🚪" title="כבר לא בקבוצה" />;
  if (!pg.pub) return <Empty icon="⏳" title={pg.load === 'offline' ? 'אין חיבור' : pg.load === 'error' ? 'משהו השתבש' : 'טוען…'} />;

  if (!pg.pub.me.playerId && !later && pg.pub.players.length > 0) {
    return (
      <ClaimView
        onLater={() => {
          saveJSON(laterKey(current.id), true);
          setLater(true);
        }}
      />
    );
  }

  const live = liveNow(pg.live, now);
  const card = rateCard(pg.pub, pg.votes);
  return (
    <section className="player-home" aria-label="הערב">
      {card !== 'none' && (
        <div className="rate-card">
          <p>
            <strong>{card === 'update' ? 'הדירוגים שלך' : 'רוצה לדרג את החברים?'}</strong>
            <span className="hint small">הדירוג אנונימי ונכנס לממוצע</span>
          </p>
          <button type="button" className="btn btn-primary btn-small" onClick={() => go(card === 'claim' ? 'claim' : 'rate', card === 'claim' ? 'rate' : '')}>
            {card === 'update' ? 'לעדכן' : 'לדרג'}
          </button>
        </div>
      )}
      {live ? (
        <LiveView data={live} roster={pg.pub.players} me={pg.pub.me.playerId} now={now} />
      ) : (
        <Empty icon="🌙" title="אין ערב עכשיו" />
      )}
    </section>
  );
}

/** Re-render every `ms` (the live clock). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** "Who are you?": one tap on your name. Used on first entry and before rating. */
export function ClaimView({ onLater, onDone }: { onLater?: () => void; onDone?: () => void }) {
  const pg = usePlayerGroup();
  const { notify } = useUi();
  const [busy, setBusy] = useState(false);
  if (!pg.pub) return null;
  const pick = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const err = await pg.claim(id);
    setBusy(false);
    if (!err) return onDone?.();
    notify(err === 'taken' ? 'השם הזה כבר תפוס' : err === 'offline' ? 'אין חיבור לאינטרנט' : 'משהו השתבש, נסו שוב');
  };
  return (
    <section className="claim" aria-label="מי אתה?">
      {onLater && (
        <h1 id="claim-h" className="claim-title">
          מי אתה?
        </h1>
      )}
      <div className="claim-grid">
        {claimChoices(pg.pub).map((p) => (
          <button key={p.id} type="button" className="member chip" disabled={p.taken || busy} onClick={() => void pick(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <p className="hint small center">השם שלך תפוס? בקשו מהמארגן לשחרר</p>
      {onLater && (
        <div className="row-links">
          <button type="button" className="text-btn" onClick={onLater}>
            אחר כך
          </button>
        </div>
      )}
    </section>
  );
}

/** Tonight, as the organizer's phone publishes it. */
export function LiveView({ data, roster, me, now }: { data: LiveData; roster: PublicPlayer[]; me: string | null; now: number }) {
  const name = (id: string) => liveName(data, roster, id);
  const badges = (id: string) => {
    const p = roster.find((x) => x.id === id);
    // Field positions only: the 🧤 in these lists already means "in goal now".
    return p ? <PositionBadges player={{ canGK: false, positions: p.positions }} /> : null;
  };
  const look = (t: number): TeamLook => bibLook(data.teams[t]?.bib, t);
  const m = data.match;
  const elapsed = m ? liveClockMs(m.clock, now) : 0;
  const left = m && m.clock.lengthMs !== null ? m.clock.lengthMs - elapsed : null;
  const over = left !== null && left < 0;
  const onPitch = new Set(m?.onPitch ?? []);
  const borrowed = new Set(m?.borrow?.ids ?? []);
  const next = m?.queue[0];

  return (
    <div className="live">
      {m && (
        <>
          <div className="match-no">משחק {m.n}</div>
          <div className={`clock ${over ? 'over' : ''}`} role="timer" aria-live="off">
            {left === null ? clockText(elapsed) : over ? `+${clockText(left)}` : clockText(left)}
          </div>
          {m.extra && <p className="hint center">תיקו · תוספת זמן</p>}
          <div className="pitch">
            {m.onPitch.map((t, side) => {
              const l = look(t);
              const keeper = data.teams[t]?.keeper;
              const scorers = m.goals.filter((g) => g.team === t && g.by).map((g) => name(g.by!));
              return (
                <div key={t} className="side" style={{ '--team': l.color } as React.CSSProperties}>
                  <h2>{l.name}</h2>
                  <div className="goals" aria-label={`${l.name}: ${m.score[side]}`}>
                    {m.score[side]}
                  </div>
                  <div className="keeper">{keeper ? `🧤 ${name(keeper)}` : ''}</div>
                  {scorers.length > 0 && <div className="keeper">⚽ {scorers.join(', ')}</div>}
                </div>
              );
            })}
          </div>
          {m.borrow && m.borrow.ids.length > 0 && (
            <p className="hint center">
              {m.borrow.ids.map(name).join(', ')} {m.borrow.ids.length > 1 ? 'משחקים' : 'משחק'} {look(m.borrow.team).in}
            </p>
          )}
          {next !== undefined && (
            <p className="hint center">
              {verb(look(next), 'הבאים', 'הבאה')}: {look(next).the}
            </p>
          )}
        </>
      )}

      <div className="team-grid">
        {data.teams.map((team, t) => {
          const l = look(t);
          const waiting = m ? !onPitch.has(t) : t >= 2;
          const place = m ? (onPitch.has(t) ? 'על המגרש' : m.queue.indexOf(t) >= 0 ? `בתור #${m.queue.indexOf(t) + 1}` : '') : t < 2 ? 'פותחים' : `בתור #${t - 1}`;
          return (
            <article key={t} className={`team ${waiting ? 'waiting' : ''}`} style={{ '--team': l.color } as React.CSSProperties} aria-label={l.the}>
              <header>
                <h2>{l.name}</h2>
                {place && <span className="team-sub">{place}</span>}
              </header>
              <ol>
                {team.ids.map((id) => (
                  <li key={id}>
                    <span className={`member ${id === me ? 'me' : ''} ${borrowed.has(id) ? 'away' : ''}`} aria-current={id === me ? 'true' : undefined}>
                      <span className="slot">{id === team.keeper ? '🧤' : ''}</span>
                      <span className="name">{name(id)}</span>
                      {badges(id)}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>

      {data.subs.length > 0 && (
        <div className="bench">
          <span className="label">מחליפים</span>
          {data.subs.map((id) => (
            <span key={id} className={`member chip ${id === me ? 'me' : ''}`}>
              {name(id)} {badges(id)}
            </span>
          ))}
        </div>
      )}

      {m && m.played.length > 0 && (
        <details className="fold">
          <summary>משחקים הערב ({m.played.length})</summary>
          <ol className="ev-matches">
            {m.played.map((h, i) => (
              <li key={i}>
                <span className="ev-no">{i + 1}</span>
                <span className="ev-match-body">
                  <span className="ev-score">
                    <span className="ev-team">
                      <span className="dot" style={{ background: look(h.a).color }} /> {look(h.a).name}
                    </span>
                    <span className="ev-goals">
                      <b>{h.goalsA}</b>
                      <span aria-hidden="true">–</span>
                      <b>{h.goalsB}</b>
                    </span>
                    <span className="ev-team">
                      {look(h.b).name} <span className="dot" style={{ background: look(h.b).color }} />
                    </span>
                  </span>
                  {h.pens && (
                    <small className="muted">
                      🥅 {verb(look(h.pens.winner), 'ניצחו', 'ניצחה')} בפנדלים {look(h.pens.winner).the}
                    </small>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** The open group's roster (for the settings line "אני: …"). */
export function useMyName(): string | null {
  const pg = usePlayerGroup();
  const { state } = useStore();
  const id = pg.pub?.me.playerId;
  return id ? (pg.pub?.players.find((p) => p.id === id)?.name ?? state.players.find((p) => p.id === id)?.name ?? null) : null;
}

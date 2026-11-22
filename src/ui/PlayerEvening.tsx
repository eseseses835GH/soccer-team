// A player starts an evening (DECISIONS → "Players start an evening (v20)"): who's here, players per
// team, teams from the server (split-teams; this phone never gets a level), one total per team, then
// he runs it like any runner. Same look as the organizer's main screen.
import { Avatar } from '../photos/Avatar';
import { useState } from 'react';
import { keyOf, planFormat } from '../engine';
import { liveFromState } from '../sync/live';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { useRunner } from '../sync/RunnerProvider';
import { resultFromSplit, splitApi, withRules, type SplitReply } from '../sync/splitRemote';
import { useSync } from '../sync/SyncProvider';
import { loadJSON, saveJSON } from '../state/storage';
import { useStore } from '../state/store';
import { useUi } from './App';
import { planSentence, SIZES } from './HomeScreen';
import { LiveView } from './PlayerHome';
import { SyncError } from '../sync/supabase';
import { checkInList } from '../state/guests';
import { GuestSheet } from './GuestSheet';
import { GUEST_ERROR } from './LateSheet';
import { withEvening, type EveningRules } from '../state/evening';
import { EveningSheet } from './EveningSheet';

const pickKey = (gid: string) => `kochot:pick:${gid}`;

export function NewEvening({ gid, onClose }: { gid: string; onClose(): void }) {
  const { state } = useStore();
  const pg = usePlayerGroup();
  const sync = useSync();
  const runner = useRunner();
  const { notify } = useUi();
  const saved = loadJSON<{ ids?: string[]; size?: number }>(pickKey(gid));
  const [present, setPresent] = useState<string[]>(() => (Array.isArray(saved?.ids) ? saved.ids.filter((id) => state.players.some((p) => p.id === id)) : []));
  const [size, setSize] = useState<number>(() => (SIZES.includes(saved?.size ?? 0) ? saved!.size! : 5));
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<{ reply: SplitReply; shown: number[][] } | null>(null);
  const [guest, setGuest] = useState(false);
  // Tonight's match rules he changed (only those go to the server, on top of the group's).
  const [tonight, setTonight] = useState<Partial<EveningRules>>({});
  const [rulesOpen, setRulesOpen] = useState(false);
  const keep = (ids: string[], s: number) => saveJSON(pickKey(gid), { ids, size: s });

  const set = new Set(present);
  const plan = planFormat(present.length, size);
  // Guests (v23) only when here tonight.
  const listed = checkInList(state.players, present);
  const sorted = [...listed].filter((p) => !filter.trim() || p.name.includes(filter.trim())).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const pick = (ids: string[]) => {
    setPresent(ids);
    keep(ids, size);
  };
  const addGuest = async (name: string, level: number, regular: boolean) => {
    const res = await pg.addGuest(name, level, regular);
    if ('error' in res) return GUEST_ERROR[res.error] ?? 'משהו השתבש, נסו שוב';
    pick([...present, res.id]);
    return null;
  };

  const split = async (again?: { reply: SplitReply; shown: number[][] }) => {
    if (busy) return;
    setBusy(true);
    try {
      const reply = await splitApi(await sync.client()).split({
        groupId: gid,
        present,
        teamSize: size,
        ...(Object.keys(tonight).length ? { rules: tonight } : {}),
        ...(again ? { seed: again.reply.seed, shown: again.shown } : {}),
      });
      if (again && keyOf(reply.assignment) === keyOf(again.reply.assignment)) notify('אין חלוקה אחרת מאוזנת באותה מידה');
      else setTeams({ reply, shown: [...(again?.shown ?? []), reply.assignment] });
    } catch (e) {
      const c = e instanceof SyncError ? e.code : 'other';
      notify(c === 'offline' ? 'אין חיבור לאינטרנט' : c === 'denied' ? 'כבר לא בקבוצה' : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  if (teams) {
    const now = Date.now();
    // His choices again on top of the reply's rules (the same values from an up-to-date function).
    const settings = withEvening(withRules(state.settings, teams.reply), tonight);
    const result = resultFromSplit(teams.reply, now);
    const data = liveFromState({ result, match: null, players: state.players, settings, now });
    const start = () => {
      runner.startNew({ ...state, settings, presentIds: [...result.playerIds, ...result.subIds], result, match: null, dayAt: now });
      onClose();
    };
    return (
      <section className="player-home" aria-label="הקבוצות">
        {data && <LiveView data={data} roster={pg.pub?.players ?? []} me={pg.pub?.me.playerId ?? null} now={now} totals={teams.reply.totals} />}
        <div className="dock">
          <button type="button" className="btn btn-hero btn-block" onClick={start}>
            התחלת משחק
          </button>
          <div className="row-2">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void split(teams)}>
              הגרלה מחדש
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setTeams(null)}>
              חזרה
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="home" aria-labelledby="new-h">
      <div className="hero">
        <h1 id="new-h">מי הגיע היום?</h1>
        <p className="hero-count" aria-live="polite">
          <strong>{present.length}</strong> מתוך {listed.length}
        </p>
      </div>

      <div className="size-row">
        <span className="label">כמה בקבוצה</span>
        <div className="size-pills" role="radiogroup" aria-label="כמה בקבוצה">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={size === s}
              className={size === s ? 'on' : ''}
              onClick={() => {
                setSize(s);
                keep(present, s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="list-foot">
        <button type="button" className="text-btn inline" onClick={() => setRulesOpen(true)}>
          הגדרות הערב
        </button>
      </p>
      {rulesOpen && <EveningSheet value={withEvening(state.settings, tonight)} onChange={(p) => setTonight((t) => ({ ...t, ...p }))} onClose={() => setRulesOpen(false)} />}

      <div className="quick-row">
        <button type="button" className="text-btn" onClick={() => pick(listed.map((p) => p.id))}>
          כולם
        </button>
        {present.length > 0 && (
          <button type="button" className="text-btn" onClick={() => pick([])}>
            ניקוי
          </button>
        )}
        {state.players.length > 12 && (
          <input className="search" placeholder="חיפוש" aria-label="חיפוש שחקן" value={filter} onChange={(e) => setFilter(e.target.value)} />
        )}
      </div>

      <ul className="attend">
        {sorted.map((p) => {
          const on = set.has(p.id);
          return (
            <li key={p.id}>
              <label className={on ? 'on' : ''}>
                <input type="checkbox" checked={on} onChange={() => pick(on ? present.filter((id) => id !== p.id) : [...present, p.id])} />
                <span className="tick" aria-hidden="true" />
                <Avatar player={p} size={32} />
                <span className="name">{p.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="list-foot">
        <button type="button" className="text-btn inline" onClick={() => setGuest(true)}>
          מישהו חדש
        </button>
      </p>
      {guest && <GuestSheet players={state.players} withLevel withKind onAdd={addGuest} onClose={() => setGuest(false)} />}

      <div className="cta-dock">
        <p className={`plan ${plan ? '' : 'warn'}`} aria-live="polite">
          {planSentence(present.length, plan, size)}
        </p>
        <button type="button" className="text-btn dock-secondary" onClick={onClose}>
          ביטול
        </button>
        <button type="button" className="btn btn-hero btn-block" disabled={!plan || busy} onClick={() => void split()}>
          {busy ? 'מערבבים…' : 'עושים כוחות'}
        </button>
      </div>
    </section>
  );
}

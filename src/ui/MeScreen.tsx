// "הדף שלי" (DECISIONS → "My page (v17)"): who is logged in, my groups and who I am in each,
// my numbers from the history already on this phone, my last evenings, and logging out.
import { useEffect, useMemo, useState } from 'react';
import { loadGroupState, meKey, type GroupMeta } from '../state/groups';
import type { EveningRecord } from '../state/history';
import { addStats, EMPTY_STATS, initialOf, myPct, myStats, recentEvenings, type MyStats, type Profile } from '../state/me';
import { bibLook } from '../state/model';
import { localKV, useGroups, useStore } from '../state/store';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { isPlayerGroup, loadPublic } from '../sync/playerGroup';
import { playersApi } from '../sync/players';
import { SyncError } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { useUi } from './App';
import { Sheet } from './components';
import { dateLabel } from './HistoryScreen';
import { Icon } from './icons';

/** The round picture (Google) or the first letter. */
export function Avatar({ profile, size = 30 }: { profile: Profile; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [profile.avatar]);
  const style = { inlineSize: size, blockSize: size, fontSize: size * 0.45 };
  return profile.avatar && !broken ? (
    <img className="avatar" src={profile.avatar} alt="" width={size} height={size} style={style} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setBroken(true)} />
  ) : (
    <span className="avatar avatar-letter" style={style} aria-hidden="true">
      {initialOf(profile.name)}
    </span>
  );
}

/** Who I am in an organizer group, as the server said last time (cached per login). */
interface OrgMe {
  user: string;
  playerId: string | null;
  taken: string[];
}
const loadOrgMe = (gid: string, user: string): OrgMe | null => {
  const v = localKV.get(meKey(gid)) as OrgMe | null;
  return v && v.user === user ? v : null;
};

interface Row {
  meta: GroupMeta;
  player: boolean;
  history: EveningRecord[];
  roster: { id: string; name: string }[];
  /** undefined = don't know yet (organizer group, not fetched). */
  playerId: string | null | undefined;
  taken: string[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function MeScreen() {
  const sync = useSync();
  const groups = useGroups();
  const { state } = useStore();
  const pg = usePlayerGroup();
  const { go, notify } = useUi();
  const [orgMe, setOrgMe] = useState<Record<string, OrgMe | null>>({});
  const [claimFor, setClaimFor] = useState<Row | null>(null);
  const user = sync.userId ?? '';
  const synced = groups.index.groups.filter((g) => g.synced);

  // Organizer groups: who am I there (group_members_list → my row). Cached for offline.
  const orgIds = synced.filter((g) => !isPlayerGroup(g)).map((g) => g.id).join(',');
  useEffect(() => {
    if (!user || !orgIds) return;
    let off = false;
    void (async () => {
      const c = await sync.client().catch(() => null);
      if (!c || off) return;
      for (const gid of orgIds.split(',')) {
        const members = await playersApi(c).listMembers(gid).catch(() => null);
        if (!members || off) continue;
        const v: OrgMe = { user, playerId: members.find((m) => m.isMe)?.playerId ?? null, taken: members.filter((m) => !m.isMe && m.playerId).map((m) => m.playerId!) };
        localKV.set(meKey(gid), v);
        setOrgMe((x) => ({ ...x, [gid]: v }));
      }
    })();
    return () => {
      off = true;
    };
  }, [user, orgIds, sync.client]);

  const rows = useMemo<Row[]>(
    () =>
      synced.map((meta) => {
        const open = meta.id === groups.current.id;
        const app = open ? state : loadGroupState(localKV, meta.id);
        const player = isPlayerGroup(meta);
        const roster = app.players.map((p) => ({ id: p.id, name: p.name }));
        if (player) {
          const pub = open && pg.pub ? pg.pub : loadPublic(localKV, meta.id);
          return { meta, player, history: app.history, roster, playerId: pub?.me.playerId ?? null, taken: pub?.claimed ?? [] };
        }
        const o = orgMe[meta.id] ?? loadOrgMe(meta.id, user);
        return { meta, player, history: app.history, roster, playerId: o ? o.playerId : undefined, taken: o?.taken ?? [] };
      }),
    [groups.index, groups.current.id, state, pg.pub, orgMe, user],
  );

  const profile = sync.profile;
  if (!profile) return null;

  const mine = rows.filter((r): r is Row & { playerId: string } => !!r.playerId);
  const stats = mine.map((r) => ({ r, s: myStats(r.history, r.playerId) })).filter((x) => x.s.evenings > 0);
  const total = stats.reduce((t, x) => addStats(t, x.s), EMPTY_STATS);
  const recent = recentEvenings(mine.map((r) => ({ groupId: r.meta.id, history: r.history, playerId: r.playerId })));
  const nameOf = (r: Row) => r.roster.find((p) => p.id === r.playerId)?.name;

  const open = (gid: string, route: 'home' | 'evening' | 'claim' = 'home', param = '') => {
    groups.switchTo(gid);
    go(route, param);
  };

  return (
    <section className="me" aria-label="הדף שלי">
      <header className="me-head">
        <Avatar profile={profile} size={64} />
        <div className="me-who">
          <h1 className="me-name">{profile.name}</h1>
          {profile.email && (
            <p className="muted me-email">
              <bdi dir="ltr">{profile.email}</bdi>
            </p>
          )}
          <p className="muted small">מחובר עם {profile.google ? 'Google' : 'מייל'}</p>
        </div>
      </header>

      {rows.length > 0 && (
        <>
          <h2 className="ev-h2">הקבוצות שלי</h2>
          <ul className="ev-list me-groups">
            {rows.map((r) => {
              const me = nameOf(r);
              return (
                <li key={r.meta.id}>
                  <button type="button" onClick={() => open(r.meta.id)}>
                    <span className="ev-row-text">
                      <span className="name">{r.meta.name}</span>
                      <small className="muted">
                        {r.player ? 'שחקן' : 'מארגן'}
                        {me && ` · אני: ${me}`}
                      </small>
                    </span>
                    <span className="ev-chev" aria-hidden="true">
                      <Icon name="back" size={18} />
                    </span>
                  </button>
                  {!me && r.playerId !== undefined && r.roster.length > 0 && (
                    <button type="button" className="text-btn me-claim" onClick={() => (r.player ? open(r.meta.id, 'claim') : setClaimFor(r))}>
                      עוד לא בחרת מי אתה
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {stats.length > 0 && (
        <>
          <h2 className="ev-h2">הסטטיסטיקה שלי</h2>
          <table className="me-table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">ערבים</th>
                <th scope="col">משחקים</th>
                <th scope="col">ניצחונות</th>
                <th scope="col">שערים</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(({ r, s }) => (
                <StatRow key={r.meta.id} label={r.meta.name} s={s} />
              ))}
              {stats.length > 1 && <StatRow label="סה״כ" s={total} total />}
            </tbody>
          </table>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="ev-h2">ערבים אחרונים</h2>
          <ul className="ev-list">
            {recent.map(({ groupId, rec, stats: s }) => {
              const r = rows.find((x) => x.meta.id === groupId)!;
              const t = rec.teams.findIndex((x) => x.ids.includes(r.playerId!));
              return (
                <li key={`${groupId}:${rec.id}`}>
                  <button type="button" onClick={() => open(groupId, 'evening', rec.id)}>
                    <span className="ev-row-dot" style={{ background: t >= 0 ? bibLook(rec.teams[t].bib, t).color : 'var(--sunk)' }} aria-hidden="true" />
                    <span className="ev-row-text">
                      <span className="name">{dateLabel(rec.startedAt)}</span>
                      <small className="muted">
                        {rows.length > 1 && `${r.meta.name} · `}
                        {plural(s.played, 'משחק אחד', 'משחקים')} · {plural(s.won, 'ניצחון אחד', 'ניצחונות')}
                        {s.goals > 0 && ` · ${plural(s.goals, 'שער אחד', 'שערים')}`}
                      </small>
                    </span>
                    <span className="ev-chev" aria-hidden="true">
                      <Icon name="back" size={18} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="stack me-out">
        <button type="button" className="btn btn-quiet btn-block" onClick={() => void sync.signOut().then(() => go('home'))}>
          יציאה מהחשבון
        </button>
      </div>

      {claimFor && (
        <Sheet title="מי אתה?" onClose={() => setClaimFor(null)}>
          <OrgClaim
            row={claimFor}
            onDone={(playerId) => {
              const v: OrgMe = { user, playerId, taken: claimFor.taken };
              localKV.set(meKey(claimFor.meta.id), v);
              setOrgMe((x) => ({ ...x, [claimFor.meta.id]: v }));
              setClaimFor(null);
            }}
            notify={notify}
          />
        </Sheet>
      )}
    </section>
  );
}

function StatRow({ label, s, total = false }: { label: string; s: MyStats; total?: boolean }) {
  const pct = myPct(s);
  return (
    <tr className={total ? 'me-total' : undefined}>
      <th scope="row">{label}</th>
      <td>{s.evenings}</td>
      <td>{s.played}</td>
      <td>
        {s.won}
        {pct !== null && <small className="muted"> ({pct}%)</small>}
      </td>
      <td>{s.goals}</td>
    </tr>
  );
}

/** An organizer says which roster name is him (claim_player; organizers may claim too). */
function OrgClaim({ row, onDone, notify }: { row: Row; onDone: (playerId: string) => void; notify: (m: string) => void }) {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const taken = new Set(row.taken);
  const list = [...row.roster].sort((a, b) => Number(taken.has(a.id)) - Number(taken.has(b.id)) || a.name.localeCompare(b.name, 'he'));
  const pick = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await playersApi(await sync.client()).claimPlayer(row.meta.id, id);
      onDone(id);
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'other';
      notify(code === 'taken' ? 'השם הזה כבר תפוס' : code === 'offline' ? 'אין חיבור לאינטרנט' : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="claim-grid">
      {list.map((p) => (
        <button key={p.id} type="button" className="member chip" disabled={taken.has(p.id) || busy} onClick={() => void pick(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

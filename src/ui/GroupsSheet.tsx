import { useCallback, useEffect, useState } from 'react';
import { MAX_GROUP_NAME } from '../state/groups';
import { useGroups, useStore } from '../state/store';
import { STATUS_TEXT, useSync } from '../sync/SyncProvider';
import { useUi } from './App';
import { Sheet } from './components';
import { Icon } from './icons';
import { InviteFriends } from './InviteFriends';
import { OrganizersSheet } from './OrganizersSheet';
import { isPlayerGroup } from '../sync/playerGroup';
import { gateNewGroup } from '../sync/gate';
import { leavePlan, type LeavePlan } from '../sync/organizers';
import { playersApi, type Member } from '../sync/players';
import { SyncError } from '../sync/supabase';

type Mode = 'list' | 'new' | 'rename' | 'remove' | 'organizers';

/** Switch between groups (שכונה, בסיס, משרד…), add one, and manage the open one. */
export function GroupsSheet({ onClose }: { onClose: () => void }) {
  const groups = useGroups();
  const sync = useSync();
  const { notify } = useUi();
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = groups.current;
  const only = groups.index.groups.length <= 1;
  /** A player group: read-only, so only "leave". */
  const player = isPlayerGroup(cur);

  const pick = (id: string) => {
    if (id !== cur.id) {
      groups.switchTo(id);
      notify(`עברתם ל״${groups.index.groups.find((g) => g.id === id)?.name}״`);
    }
    onClose();
  };

  /** Two groups with the same name would be impossible to tell apart in the list. */
  const taken = (n: string, except?: string) => groups.index.groups.some((g) => g.id !== except && g.name.trim() === n.trim());

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (taken(name)) return notify('כבר יש קבוצה בשם הזה');
    sync.createGroup(name);
    notify(`נוצרה הקבוצה ״${name.trim()}״`);
    onClose();
  };

  const rename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (taken(name, cur.id)) return notify('כבר יש קבוצה בשם הזה');
    groups.rename(cur.id, name);
    setMode('list');
  };

  const remove = async () => {
    if (cur.synced) {
      setBusy(true);
      const ok = await sync.leaveCurrent();
      setBusy(false);
      if (!ok) return;
      notify('יצאתם מהקבוצה');
    } else {
      groups.remove(cur.id);
      notify('הקבוצה נמחקה');
    }
    setMode('list');
  };

  if (mode === 'remove' && cur.synced && !player) {
    return <LeaveCloudGroup onBack={() => setMode('list')} onClose={onClose} />;
  }

  if (mode === 'organizers' && cur.synced && sync.email) {
    return <OrganizersSheet onBack={() => setMode('list')} onClose={onClose} />;
  }

  if (mode === 'new' || mode === 'rename') {
    return (
      <Sheet title={mode === 'new' ? 'קבוצה חדשה' : 'שינוי שם'} onClose={onClose}>
        <form className="stack" onSubmit={mode === 'new' ? create : rename}>
          {mode === 'new' && <p className="lead">לכל קבוצה יש שחקנים והגדרות משלה. למשל כדורגל בשכונה, בבסיס או במשרד.</p>}
          <input
            className="input input-big"
            aria-label="שם הקבוצה"
            placeholder="למשל: כדורגל בשכונה"
            maxLength={MAX_GROUP_NAME}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim()}>
            {mode === 'new' ? 'יצירה' : 'שמירה'}
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setMode('list')}>
            ביטול
          </button>
        </form>
      </Sheet>
    );
  }

  if (mode === 'remove') {
    return (
      <Sheet title={cur.synced ? 'יציאה מהקבוצה' : 'מחיקת הקבוצה'} onClose={onClose}>
        <p className="lead">
          {player
            ? `״${cur.name}״ תוסר מהטלפון הזה.`
            : `כל השחקנים וההגדרות של ״${cur.name}״ יימחקו מהטלפון הזה. אי אפשר לבטל.`}
        </p>
        <div className="stack">
          <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={remove}>
            {cur.synced ? 'יציאה מהקבוצה' : 'מחיקה'}
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setMode('list')}>
            ביטול
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="הקבוצות שלי" onClose={onClose}>
      <ul className="group-list">
        {groups.index.groups.map((g) => (
          <li key={g.id}>
            <button type="button" aria-current={g.id === cur.id ? 'true' : undefined} onClick={() => pick(g.id)}>
              <span className={`group-check ${g.id === cur.id ? 'on' : ''}`} aria-hidden="true">
                {g.id === cur.id ? '✓' : ''}
              </span>
              <span className="group-text">
                <strong>
                  {g.name}
                  {isPlayerGroup(g) && <span className="role-tag">שחקן</span>}
                </strong>
                <small>{g.id === cur.id && g.synced ? STATUS_TEXT[sync.status] : g.synced ? 'מסונכרנת' : STATUS_TEXT.local}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-quiet btn-block"
        onClick={() => {
          const go = () => {
            setName('');
            setMode('new');
          };
          // Logged out: one group only. After logging in, on to the new group (v13).
          if (gateNewGroup(sync.loggedOut) === 'group') sync.openLogin('group', go);
          else go();
        }}
      >
        <Icon name="plus" size={20} /> קבוצה חדשה
      </button>

      <h3 className="sheet-sub">״{cur.name}״</h3>
      <div className="stack">
        {sync.configured && !player && (
          <>
            <InviteFriends className="btn btn-primary btn-block" />
            <p className="hint small">קישור לשחקנים (רואים את הערב והסטטיסטיקות, בלי דירוגים) או למארגן נוסף.</p>
          </>
        )}
        <div className={player ? 'stack' : 'row-2'}>
          {!player && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setName(cur.name);
                setMode('rename');
              }}
            >
              שינוי שם
            </button>
          )}
          <button type="button" className="btn btn-quiet danger" disabled={only && !cur.synced} onClick={() => setMode('remove')}>
            {cur.synced ? 'יציאה' : 'מחיקה'}
          </button>
        </div>
        {only && !cur.synced && <p className="hint small">זו הקבוצה היחידה בטלפון, אז אי אפשר למחוק אותה.</p>}
      </div>
    </Sheet>
  );
}

type Load = 'loading' | 'offline' | 'error' | 'ok';

/**
 * Leaving a cloud group I organize (DECISIONS → "Leaving as the last organizer"): who stays is read
 * from the server; the last organizer with players picks one of them to take over, or deletes the
 * group for everyone.
 */
function LeaveCloudGroup({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const groups = useGroups();
  const sync = useSync();
  const { notify } = useUi();
  const roster = useStore().state.players;
  const cur = groups.current;
  const [load, setLoad] = useState<Load>('loading');
  const [plan, setPlan] = useState<LeavePlan<Member>>({ kind: 'leave' });
  const [pick, setPick] = useState<Member | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const client = sync.client;
  const refresh = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setLoad('offline');
    try {
      setPlan(leavePlan(await playersApi(await client()).listMembers(cur.id)));
      setLoad('ok');
    } catch (e) {
      setLoad(e instanceof SyncError && e.code === 'offline' ? 'offline' : 'error');
    }
  }, [client, cur.id]);

  useEffect(() => {
    void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => setLoad('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const go = async (how?: { to: string } | 'delete') => {
    setBusy(true);
    const ok = await sync.leaveCurrent(how);
    setBusy(false);
    if (!ok) {
      setPick(null);
      setDel(false);
      return void refresh();
    }
    notify(how === 'delete' ? 'הקבוצה נמחקה' : 'יצאתם מהקבוצה');
    onBack();
  };

  const cancel = (
    <button type="button" className="btn btn-quiet btn-block" onClick={pick || del ? () => (setPick(null), setDel(false)) : onBack}>
      ביטול
    </button>
  );

  if (del) {
    return (
      <Sheet title="למחוק את הקבוצה לכולם?" onClose={onClose}>
        <p className="lead">השחקנים, הערבים והדירוגים של ״{cur.name}״ יימחקו לכל מי שבקבוצה. אי אפשר לבטל.</p>
        <div className="stack">
          <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={() => go('delete')}>
            למחוק את הקבוצה לכולם
          </button>
          {cancel}
        </div>
      </Sheet>
    );
  }

  if (pick) {
    return (
      <Sheet title="מי יהיה המארגן?" onClose={onClose}>
        <p className="lead">
          <bdi>{pick.name}</bdi> ינהל את ״{cur.name}״, ואתם תצאו מהקבוצה.
        </p>
        <div className="stack">
          <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={() => go({ to: pick.userId })}>
            יציאה מהקבוצה
          </button>
          {cancel}
        </div>
      </Sheet>
    );
  }

  if (load === 'ok' && plan.kind === 'handoff') {
    const plays = (m: Member) => (m.playerId && roster.find((p) => p.id === m.playerId)?.name) || '';
    return (
      <Sheet title="מי יהיה המארגן?" onClose={onClose}>
        <p className="lead">אתם המארגנים האחרונים. בחרו שחקן שימשיך לנהל את הקבוצה.</p>
        <ul className="group-list">
          {plan.players.map((m) => (
            <li key={m.userId}>
              <button type="button" onClick={() => setPick(m)}>
                <span className="group-text">
                  <strong>
                    <bdi>{m.name}</bdi>
                  </strong>
                  {plays(m) && plays(m) !== m.name && <small>{plays(m)}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="stack">
          {cancel}
          <button type="button" className="text-btn danger" onClick={() => setDel(true)}>
            למחוק את הקבוצה לכולם
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="יציאה מהקבוצה" onClose={onClose}>
      <p className="lead">
        {load === 'offline'
          ? 'צריך אינטרנט כדי לצאת מהקבוצה.'
          : load === 'ok' && plan.kind === 'last'
          ? `אתם המארגנים האחרונים ואין שחקנים בקבוצה, אז ״${cur.name}״ תימחק גם מהשרת.`
          : load === 'ok'
          ? `״${cur.name}״ תוסר מהטלפון הזה, והמארגנים האחרים ימשיכו כרגיל.`
          : `״${cur.name}״ תוסר מהטלפון הזה.`}
      </p>
      <div className="stack">
        <button type="button" className="btn btn-danger btn-block" disabled={busy || load === 'loading' || load === 'offline'} onClick={() => go()}>
          יציאה מהקבוצה
        </button>
        {cancel}
      </div>
    </Sheet>
  );
}

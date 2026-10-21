import { useCallback, useEffect, useState } from 'react';
import { useGroups, useStore } from '../state/store';
import { usePlayerVotes } from '../sync/OrganizerSync';
import { playerMemberRows, type PlayerMemberRow } from '../sync/organizer';
import { playersApi, type Member } from '../sync/players';
import { creatorName, expiresIn, inviteUrl, shortDate, type Invite, type Organizer } from '../sync/organizers';
import { SyncError, redirectUrl, remoteApi } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { copyText, nativeShare } from '../share';
import { useUi } from './App';
import { Sheet, Toggle } from './components';
import { Icon } from './icons';

type Load = 'loading' | 'offline' | 'auth' | 'error' | 'ok';

const loadState = (e: unknown): Load => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (e instanceof SyncError) return e.code === 'offline' ? 'offline' : e.code === 'auth' || e.code === 'denied' ? 'auth' : 'error';
  return 'error';
};

/** Who organizes the open cloud group, and its live invite links (copy, revoke, new). */
export function OrganizersSheet({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const groups = useGroups();
  const sync = useSync();
  const { notify } = useUi();
  const cur = groups.current;
  const [load, setLoad] = useState<Load>('loading');
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [playerLink, setPlayerLink] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const rows = playerMemberRows(members, useStore().state.players);
  const [confirm, setConfirm] = useState<string | null>(null);
  const votes = usePlayerVotes();
  const [busy, setBusy] = useState(false);

  const client = sync.client; // stable, unlike the whole sync object
  const refresh = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setLoad('offline');
    try {
      const c = await client();
      const api = remoteApi(c);
      const pApi = playersApi(c);
      const [o, i, pl, m] = await Promise.all([api.listOrganizers(cur.id), api.listInvites(cur.id), pApi.playerInvite(cur.id), pApi.listMembers(cur.id)]);
      setOrganizers(o);
      setInvites(i);
      setPlayerLink(pl);
      setMembers(m);
      setLoad('ok');
    } catch (e) {
      setLoad(loadState(e));
    }
  }, [client, cur.id]);

  useEffect(() => {
    setLoad('loading');
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

  const share = async (url: string, asPlayer = false) => {
    const text = asPlayer ? `הצטרפו לקבוצה ״${cur.name}״ בכוחות` : `הצטרפו כמארגנים לקבוצה ״${cur.name}״ בכוחות`;
    if (await nativeShare({ title: cur.name, text, url })) return;
    notify((await copyText(url)) ? 'קישור ההזמנה הועתק' : 'ההעתקה נכשלה');
  };

  const newLink = async () => {
    setBusy(true);
    const url = await sync.inviteLink();
    setBusy(false);
    if (!url) return;
    void refresh();
    await share(url);
  };

  const newPlayerLink = async () => {
    setBusy(true);
    try {
      const token = await playersApi(await client()).createPlayerInvite(cur.id);
      setPlayerLink(token);
      await share(inviteUrl(token, redirectUrl()), true);
    } catch (e) {
      notify(loadState(e) === 'offline' ? 'צריך חיבור לאינטרנט' : 'יצירת הקישור לא הצליחה');
    } finally {
      setBusy(false);
    }
  };

  /** A change to a player member; the list is read again after it (and the votes, which it may change). */
  const memberDo = async (f: (api: ReturnType<typeof playersApi>) => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await f(playersApi(await client()));
      if (done) notify(done);
    } catch (e) {
      notify(loadState(e) === 'offline' ? 'צריך חיבור לאינטרנט' : 'זה לא הצליח, נסו שוב');
    } finally {
      setBusy(false);
      setConfirm(null);
      void refresh();
      votes.refresh();
    }
  };

  const setCanRate = (m: PlayerMemberRow, can: boolean) => {
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, canRate: can } : x)));
    void memberDo((api) => api.setCanRate(cur.id, m.userId, can));
  };

  const revoke = async (token: string) => {
    setBusy(true);
    try {
      await remoteApi(await client()).revokeInvite(token);
      setInvites((list) => list.filter((i) => i.token !== token));
      if (token === playerLink) setPlayerLink(null);
      notify('הקישור בוטל');
    } catch (e) {
      notify(loadState(e) === 'offline' ? 'צריך חיבור לאינטרנט' : 'הביטול לא הצליח');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Sheet title="מארגנים והזמנות" onClose={onClose}>
      <button type="button" className="text-btn back-link" onClick={onBack}>
        <Icon name="back" size={18} /> ״{cur.name}״
      </button>

      {load === 'loading' && <p className="hint center org-state">טוען…</p>}
      {load !== 'loading' && load !== 'ok' && (
        <div className="org-state stack">
          <p className="hint center">
            {load === 'offline' ? 'צריך חיבור לאינטרנט' : load === 'auth' ? 'צריך להתחבר שוב לחשבון' : 'לא הצלחנו לטעון. נסו שוב'}
          </p>
          {load === 'auth' ? (
            <button type="button" className="btn btn-quiet btn-block" onClick={() => sync.openLogin('account')}>
              התחברות
            </button>
          ) : (
            <button type="button" className="btn btn-quiet btn-block" onClick={() => void refresh()}>
              נסו שוב
            </button>
          )}
        </div>
      )}

      {load === 'ok' && (
        <>
          <h3 className="sheet-sub">מארגנים ({organizers.length})</h3>
          <ul className="org-list">
            {organizers.map((o) => (
              <li key={o.userId}>
                <span className="org-avatar" aria-hidden="true">
                  {o.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="group-text">
                  <strong>
                    <bdi>{o.name}</bdi>
                    {o.isMe && <span className="org-me"> (את/ה)</span>}
                  </strong>
                  {o.joinedAt && <small>הצטרפ/ה ב־{shortDate(o.joinedAt)}</small>}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint small">כל המארגנים רואים ועורכים את כל הקבוצה, כולל הדירוגים.</p>

          <h3 className="sheet-sub">קישורי הזמנה פעילים</h3>
          {invites.length === 0 ? (
            <p className="hint">אין קישורים פעילים.</p>
          ) : (
            <ul className="org-list invites">
              {invites.map((i) => (
                <li key={i.token}>
                  {confirm === i.token ? (
                    <div className="org-confirm">
                      <span>לבטל את הקישור? מי שכבר הצטרף נשאר בקבוצה.</span>
                      <div className="row-2">
                        <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => void revoke(i.token)}>
                          כן, לבטל
                        </button>
                        <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirm(null)}>
                          לא
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="org-avatar link" aria-hidden="true">
                        <Icon name="link" size={16} />
                      </span>
                      <span className="group-text">
                        <strong>
                          נוצר ע״י <bdi>{creatorName(i, organizers)}</bdi> ב־{shortDate(i.createdAt)}
                        </strong>
                        <small>
                          {expiresIn(i.expiresAt)}, עד {shortDate(i.expiresAt)}
                        </small>
                      </span>
                      <span className="org-actions">
                        <button type="button" className="text-btn" aria-label="שיתוף הקישור" onClick={() => void share(inviteUrl(i.token, redirectUrl()))}>
                          <Icon name="share" size={18} />
                        </button>
                        <button type="button" className="text-btn danger" onClick={() => setConfirm(i.token)}>
                          ביטול
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => void newLink()}>
            <Icon name="plus" size={20} /> קישור חדש
          </button>
          <p className="hint small">קישור תקף לשבועיים, ואפשר להצטרף איתו כמה פעמים. ביטול לא מוציא מי שכבר הצטרף.</p>

          <h3 className="sheet-sub">שחקנים</h3>
          {playerLink ? (
            <ul className="org-list invites">
              <li>
                {confirm === playerLink ? (
                  <div className="org-confirm">
                    <span>לבטל את הקישור לשחקנים? מי שכבר הצטרף נשאר.</span>
                    <div className="row-2">
                      <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => void revoke(playerLink)}>
                        כן, לבטל
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirm(null)}>
                        לא
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="org-avatar link" aria-hidden="true">
                      <Icon name="link" size={16} />
                    </span>
                    <span className="group-text">
                      <strong>קישור לשחקנים</strong>
                    </span>
                    <span className="org-actions">
                      <button type="button" className="text-btn" aria-label="שיתוף הקישור לשחקנים" onClick={() => void share(inviteUrl(playerLink, redirectUrl()), true)}>
                        <Icon name="share" size={18} />
                      </button>
                      <button type="button" className="text-btn danger" onClick={() => setConfirm(playerLink)}>
                        ביטול
                      </button>
                    </span>
                  </>
                )}
              </li>
            </ul>
          ) : (
            <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => void newPlayerLink()}>
              <Icon name="link" size={18} /> קישור לשחקנים
            </button>
          )}
          <p className="hint small">שחקנים רואים את הכוחות, המשחק וההיסטוריה. לא את הדירוגים.</p>

          {rows.length > 0 && (
            <>
              <h3 className="sheet-sub">שחקנים שהתחברו ({rows.length})</h3>
              <ul className="org-list members">
                {rows.map((m) => {
                  const { claimed } = m;
                  const key = `m:${m.userId}`;
                  return (
                    <li key={m.userId}>
                      {confirm === key ? (
                        <div className="org-confirm">
                          <span>
                            <bdi>{m.name}</bdi>
                          </span>
                          <div className="row-2">
                            {m.canUnclaim && (
                              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void memberDo((api) => api.unclaimPlayer(cur.id, m.userId))}>
                                לבטל את הבחירה
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-danger btn-small"
                              disabled={busy}
                              onClick={() => void memberDo((api) => api.removePlayer(cur.id, m.userId), 'הוסר מהקבוצה')}
                            >
                              להסיר מהקבוצה
                            </button>
                          </div>
                          <button type="button" className="text-btn" onClick={() => setConfirm(null)}>
                            חזרה
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="org-avatar" aria-hidden="true">
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="group-text">
                            <strong>
                              <bdi>{m.name}</bdi>
                            </strong>
                            <small>{claimed ? <>בחר: <bdi>{claimed}</bdi></> : 'עוד לא בחר'}</small>
                          </span>
                          <Toggle checked={m.canRate} onChange={(v) => setCanRate(m, v)} label="יכול לדרג" />
                          <button type="button" className="icon-btn" aria-label={`הסרה של ${m.name}`} onClick={() => setConfirm(key)}>
                            ✕
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

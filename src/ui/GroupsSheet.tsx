import { useState } from 'react';
import { MAX_GROUP_NAME } from '../state/groups';
import { useGroups } from '../state/store';
import { STATUS_TEXT, useSync } from '../sync/SyncProvider';
import { copyText, nativeShare } from '../share';
import { useUi } from './App';
import { Sheet } from './components';
import { Icon } from './icons';
import { OrganizersSheet } from './OrganizersSheet';

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

  const pick = (id: string) => {
    if (id !== cur.id) {
      groups.switchTo(id);
      notify(`עברתם ל״${groups.index.groups.find((g) => g.id === id)?.name}״`);
    }
    onClose();
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    groups.create(name);
    notify(`נוצרה הקבוצה ״${name.trim()}״`);
    onClose();
  };

  const rename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    groups.rename(cur.id, name);
    setMode('list');
  };

  const invite = async () => {
    setBusy(true);
    const url = await sync.inviteLink();
    setBusy(false);
    if (!url) return;
    const text = `הצטרפו כמארגנים לקבוצה ״${cur.name}״ בכוחות`;
    if (await nativeShare({ title: cur.name, text, url })) return;
    notify((await copyText(url)) ? 'קישור ההזמנה הועתק' : 'ההעתקה נכשלה');
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
          {cur.synced
            ? `״${cur.name}״ תוסר מהטלפון הזה, והמארגנים האחרים ימשיכו כרגיל. אם אתם המארגנים האחרונים, הקבוצה תימחק גם מהשרת.`
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
                <strong>{g.name}</strong>
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
          setName('');
          setMode('new');
        }}
      >
        <Icon name="plus" size={20} /> קבוצה חדשה
      </button>

      <h3 className="sheet-sub">״{cur.name}״</h3>
      <div className="stack">
        {sync.configured &&
          (cur.synced ? (
            <>
              <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={invite}>
                <Icon name="link" size={20} /> הזמנת מארגן
              </button>
              {sync.email && (
                <button type="button" className="btn btn-quiet btn-block" onClick={() => setMode('organizers')}>
                  <Icon name="users" size={20} /> מארגנים והזמנות
                </button>
              )}
              <p className="hint small">מי שמקבל את הקישור ומתחבר יראה ויערוך את כל הקבוצה, כולל הדירוגים. הקישור תקף לשבועיים.</p>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => void sync.uploadCurrent()}>
                <Icon name="upload" size={20} /> סנכרון בין טלפונים
              </button>
              <p className="hint small">שומר את הקבוצה בחשבון, כדי שעוד מארגנים יוכלו לערוך אותה מהטלפון שלהם. דורש התחברות.</p>
            </>
          ))}
        <div className="row-2">
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
          <button type="button" className="btn btn-quiet danger" disabled={only && !cur.synced} onClick={() => setMode('remove')}>
            {cur.synced ? 'יציאה' : 'מחיקה'}
          </button>
        </div>
        {only && !cur.synced && <p className="hint small">זו הקבוצה היחידה בטלפון, אז אי אפשר למחוק אותה.</p>}
      </div>
    </Sheet>
  );
}

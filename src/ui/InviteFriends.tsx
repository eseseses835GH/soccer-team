import { useEffect, useRef, useState } from 'react';
import { useGroups } from '../state/store';
import { isPlayerGroup } from '../sync/playerGroup';
import { useSync } from '../sync/SyncProvider';
import { useUi } from './App';
import { Icon } from './icons';
import { OrganizersSheet } from './OrganizersSheet';

/**
 * "הזמנת חברים": one obvious way to the player/organizer links. Logged out → log in first; a group
 * that isn't on the server yet → upload it; then the sheet with the links opens.
 */
export function InviteFriends({ className = 'text-btn' }: { className?: string }) {
  const sync = useSync();
  const groups = useGroups();
  const { notify } = useUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = useRef(false);
  const cur = groups.current;

  // After a login started from here, open the sheet once the group reached the server.
  useEffect(() => {
    if (waiting.current && sync.email && cur.synced) {
      waiting.current = false;
      setBusy(false);
      setOpen(true);
    }
  }, [sync.email, cur.synced]);

  if (!sync.configured || isPlayerGroup(cur)) return null;

  const start = async () => {
    if (!sync.email) {
      waiting.current = true;
      sync.openLogin('invite');
      return;
    }
    if (!cur.synced) {
      setBusy(true);
      waiting.current = true;
      try {
        await sync.uploadCurrent();
      } catch {
        waiting.current = false;
        setBusy(false);
        notify('לא הצלחנו להעלות את הקבוצה. בדקו את החיבור ונסו שוב');
      }
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button type="button" className={className} onClick={() => void start()} disabled={busy}>
        <Icon name="link" size={18} /> {busy ? 'מכינים קישור…' : 'הזמנת חברים'}
      </button>
      {open && <OrganizersSheet onBack={() => setOpen(false)} onClose={() => setOpen(false)} />}
    </>
  );
}

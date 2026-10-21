import { useCallback } from 'react';
import type { Player } from '../state/model';
import { useGroups } from '../state/store';
import { LIMIT_TEXT, gatePlayers } from '../sync/gate';
import { useSync } from '../sync/SyncProvider';
import { useUi } from './App';

/**
 * Wrap an action that adds players: runs it now, or (logged out, past the free limit) opens the
 * login sheet and runs it once logged in. Returns true if it ran now.
 */
export function usePlayerGate() {
  const sync = useSync();
  const groups = useGroups();
  const { notify } = useUi();
  return useCallback(
    (added: Player[], go: () => void) => {
      const r = gatePlayers(sync.loggedOut, groups.latest().app.players, added);
      if (r === 'full') {
        notify(LIMIT_TEXT.players_limit);
        return false;
      }
      if (r === 'players') {
        sync.openLogin('players', go);
        return false;
      }
      go();
      return true;
    },
    [sync, groups, notify],
  );
}

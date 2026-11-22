/**
 * Tapping a round photo opens that player's card. The data comes from this phone: organizer phones
 * score from the level; players' phones only from the public copy's `score`.
 */
import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { OpenCardCtx } from '../photos/Avatar';
import { useGroups, useStore } from '../state/store';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { cardData } from './cardData';

const CardSheet = lazy(() => import('./CardSheet'));

export function CardViewer({ notify, children }: { notify: (m: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const { state } = useStore();
  const { current } = useGroups();
  const pg = usePlayerGroup();
  const openCard = useCallback((id: string) => setOpen(id), []);
  const data = open ? cardData(open, state.players, state.history, pg.active ? (pg.pub ?? { players: [] }) : null) : null;
  return (
    <OpenCardCtx.Provider value={openCard}>
      {children}
      {data && (
        <Suspense fallback={null}>
          <CardSheet data={data} groupId={current.id} notify={notify} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </OpenCardCtx.Provider>
  );
}

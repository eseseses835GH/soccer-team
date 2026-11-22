/** "הקלפים": everyone's cards in the group, as a grid (the sheet loads only when opened). */
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../ui/icons';

const CardsSheet = lazy(() => import('./CardsSheet'));

export function CardsButton({ notify, inline = false, icon = false }: { notify: (m: string) => void; inline?: boolean; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon ? (
        <button type="button" className="icon-btn cards-btn" data-tour="cards" aria-label="הקלפים" title="הקלפים" onClick={() => setOpen(true)}>
          <Icon name="cards" size={24} />
        </button>
      ) : (
        <button type="button" className={`text-btn ${inline ? 'inline' : ''}`} data-tour="cards" onClick={() => setOpen(true)}>
          הקלפים
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <CardsSheet notify={notify} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

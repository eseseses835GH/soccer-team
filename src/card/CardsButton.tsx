/** "הקלפים": everyone's cards in the group, as a grid (the sheet loads only when opened). */
import { lazy, Suspense, useState } from 'react';

const CardsSheet = lazy(() => import('./CardsSheet'));

export function CardsButton({ notify }: { notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-btn" onClick={() => setOpen(true)}>
        הקלפים
      </button>
      {open && (
        <Suspense fallback={null}>
          <CardsSheet notify={notify} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

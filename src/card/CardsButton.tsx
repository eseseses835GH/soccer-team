/** "הקלפים": everyone's cards in the group, as a grid (the sheet loads only when opened). */
import { lazy, Suspense, useState } from 'react';

const CardsSheet = lazy(() => import('./CardsSheet'));

export function CardsButton({ notify, inline = false }: { notify: (m: string) => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`text-btn ${inline ? "inline" : ""}`} onClick={() => setOpen(true)}>
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

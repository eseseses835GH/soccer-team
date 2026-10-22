import { loadJSON, saveJSON } from '../state/storage';
import { PENDING_JOIN } from '../sync/SyncProvider';
import { Sheet } from './components';

/** Per phone: the first-visit "פעם ראשונה בכוחות?" was seen. */
const SEEN_KEY = 'kochot:welcomed';

/** First visit only: an empty roster, never seen, and not arriving through an invite. */
export function shouldWelcome(players: number, hash = location.hash): boolean {
  if (players > 0 || loadJSON<boolean>(SEEN_KEY)) return false;
  if (hash.startsWith('#join') || loadJSON<string>(PENDING_JOIN)) return false;
  return true;
}

export function markWelcomed() {
  saveJSON(SEEN_KEY, true);
}

/** Three steps, two buttons. */
export function Welcome({ onStart, onSample, onClose }: { onStart: () => void; onSample: () => void; onClose: () => void }) {
  const done = (fn: () => void) => () => {
    markWelcomed();
    fn();
  };
  return (
    <Sheet title="פעם ראשונה בכוחות? 👋" onClose={done(onClose)}>
      <ol className="welcome-steps">
        <li>
          <strong>מוסיפים את החבר׳ה</strong> פעם אחת, עם רמה מ־1 עד 10. אפשר גם מצ׳אט בוואטסאפ.
        </li>
        <li>
          <strong>בכל ערב מסמנים מי הגיע.</strong>
        </li>
        <li>
          <strong>לוחצים ״עושים כוחות״</strong> ומקבלים קבוצות שוות, עם טיימר ו״מנצחת נשארת״.
        </li>
      </ol>
      <div className="stack">
        <button type="button" className="btn btn-primary btn-block" onClick={done(onStart)}>
          בואו נתחיל
        </button>
        <button type="button" className="btn btn-quiet btn-block" onClick={done(onSample)}>
          לנסות עם סגל לדוגמה
        </button>
      </div>
    </Sheet>
  );
}

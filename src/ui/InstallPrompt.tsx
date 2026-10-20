// "Add to home screen" (v6): the gentle card on the main screen and the steps in Settings.
// The rule (when to show) is pure and tested in state/install.ts; this file is the browser glue.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { INSTALL_KEY, detectPlatform, neverAgain, recordUse, sanitizeFlags, snooze, type InstallFlags, type PlatformInfo } from '../state/install';
import { loadJSON, saveJSON } from '../state/storage';

/** Chromium's install event (not in the TS DOM lib). */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Module state, shared by every component. The listeners are added when this module loads (before
// the first render), because Chrome can fire `beforeinstallprompt` right after the page loads.
let deferred: InstallEvent | null = null;
let flags: InstallFlags = sanitizeFlags(loadJSON(INSTALL_KEY));
const subs = new Set<() => void>();
let snap = { flags, canPrompt: false };
const emit = () => {
  snap = { flags, canPrompt: !!deferred };
  subs.forEach((f) => f());
};
const setFlags = (f: InstallFlags) => {
  if (f === flags) return;
  flags = f;
  saveJSON(INSTALL_KEY, f);
  emit();
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we offer it ourselves, at a calmer moment
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    setFlags({ ...flags, installed: true });
  });
}

/** Opened from the home screen (Android/desktop display-mode, or iOS's navigator.standalone). */
export function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches);
  } catch {
    return false;
  }
}

const platformInfo = (): PlatformInfo => detectPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);

export function useInstall() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snap,
  );
  const info = platformInfo();
  const standalone = isStandalone();
  return {
    ...s,
    info,
    standalone,
    /** Installing is possible here: a captured prompt, or iOS (manual steps). */
    canOffer: s.canPrompt || info.platform === 'ios' || info.platform === 'ios-inapp',
    async install() {
      const e = deferred;
      if (!e) return;
      deferred = null;
      emit();
      try {
        await e.prompt();
        const { outcome } = await e.userChoice;
        // Declined in the browser's own dialog: don't ask again for a week.
        setFlags(outcome === 'accepted' ? { ...flags, installed: true } : snooze(flags, Date.now()));
      } catch {
        /* the prompt can only be used once; ignore */
      }
    },
    later: () => setFlags(snooze(flags, Date.now())),
    never: () => setFlags(neverAgain(flags)),
  };
}

/** Counts uses of the app (see recordUse): on open and whenever it comes back to the foreground. */
export function useRecordUse(hasPlayers: boolean) {
  // On open, count the use before the first render, so the card is there from the first paint
  // instead of popping in above the list (Chrome then scrolls to keep the list in place).
  useState(() => {
    if (!hasPlayers) return;
    flags = recordUse(flags, Date.now());
    saveJSON(INSTALL_KEY, flags);
    snap = { flags, canPrompt: !!deferred };
  });
  useEffect(() => {
    if (!hasPlayers) return;
    const mark = () => {
      if (document.visibilityState !== 'hidden') setFlags(recordUse(flags, Date.now()));
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [hasPlayers]);
}

/** Safari's share button: a box with an arrow up. */
export function ShareGlyph() {
  return (
    <span className="key-glyph" aria-label="שיתוף" role="img">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3v12M8 7l4-4 4 4M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" />
      </svg>
    </span>
  );
}

/** The "add to home screen" item's icon: a plus in a rounded square. */
function AddGlyph() {
  return (
    <span className="key-glyph" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
    </span>
  );
}

/** Short illustrated steps for this browser (no install API on iOS). */
export function InstallSteps({ info, compact = false }: { info: PlatformInfo; compact?: boolean }) {
  if (info.platform === 'android') {
    return (
      <ol className="install-steps">
        <li>
          בכרום: לוחצים על <span className="key-glyph">⋮</span> למעלה
        </li>
        <li>
          בוחרים ״הוספה למסך הבית״ (או ״התקנת אפליקציה״)
        </li>
      </ol>
    );
  }
  if (info.platform === 'other') {
    return (
      <>
        <p className="hint">פותחים את הקישור בטלפון:</p>
        <ul className="install-steps plain">
          <li>
            <strong>אייפון:</strong> בספארי, <ShareGlyph /> שיתוף ← ״הוספה למסך הבית״
          </li>
          <li>
            <strong>אנדרואיד:</strong> בכרום, <span className="key-glyph">⋮</span> ← ״הוספה למסך הבית״
          </li>
        </ul>
      </>
    );
  }
  const where = info.ipad ? 'למעלה, ליד הכתובת' : info.safari || info.platform === 'ios-inapp' ? 'בסרגל למטה' : 'בשורת הכתובת';
  return (
    <>
      {info.platform === 'ios-inapp' && (
        <p className="install-inapp">
          הקישור נפתח בתוך {info.inApp}. קודם פותחים אותו בספארי: <span className="key-glyph">···</span> ← ״פתיחה בספארי״ (או ״פתיחה בדפדפן״).
        </p>
      )}
      <ol className="install-steps">
        <li>
          {info.safari || info.platform === 'ios-inapp' ? 'בספארי' : 'בדפדפן'} לוחצים על <ShareGlyph /> שיתוף {where}
          {!info.ipad && info.safari && (
            <small className="step-note">
              לא רואים? לוחצים קודם על <span className="key-glyph">···</span> (ב־iOS 26)
            </small>
          )}
        </li>
        <li>
          בוחרים <AddGlyph /> ״הוספה למסך הבית״ ואז ״הוספה״
        </li>
      </ol>
      {info.platform === 'ios' && !compact && <p className="hint small">אין ״הוספה למסך הבית״? כנראה הקישור נפתח בתוך אפליקציה (כמו וואטסאפ): פותחים אותו קודם בספארי.</p>}
    </>
  );
}

const WHY_IOS = 'נפתחת במסך מלא כמו אפליקציה, והאייפון לא ימחק את השחקנים אחרי כמה ימים בלי שימוש.';
const WHY = 'נפתחת במסך מלא כמו אפליקציה, ישר ממסך הבית, גם בלי קליטה.';

/** The card on the main screen. The caller decides when (shouldOfferInstall). */
export function InstallCard({ install }: { install: ReturnType<typeof useInstall> }) {
  const ios = install.info.platform === 'ios' || install.info.platform === 'ios-inapp';
  return (
    <aside className="install-card" aria-labelledby="install-h">
      <div className="install-head">
        <img src="./icon-192.png" alt="" width="40" height="40" className="install-icon" />
        <div>
          <h2 id="install-h">להוסיף את כוחות למסך הבית?</h2>
          <p className="hint small">{ios && !install.canPrompt ? WHY_IOS : WHY}</p>
        </div>
      </div>
      {install.canPrompt ? (
        <button type="button" className="btn btn-primary btn-small install-go" onClick={() => void install.install()}>
          התקנה
        </button>
      ) : (
        <InstallSteps info={install.info} compact />
      )}
      <div className="install-actions">
        <button type="button" className="text-btn" onClick={install.later}>
          אחר כך
        </button>
        <button type="button" className="text-btn quiet" onClick={install.never}>
          לא להציג שוב
        </button>
      </div>
    </aside>
  );
}


/** The "how to add to the home screen" steps, shown inside the help screen. */
export function InstallHelp() {
  const install = useInstall();
  const done = install.standalone || install.flags.installed;
  return (
    <div className="install-settings">
      {done && !install.canPrompt ? (
        <p className="hint">{install.standalone ? 'כוחות פתוחה ממסך הבית ✓' : 'כוחות הותקנה במסך הבית ✓ פותחים אותה משם.'}</p>
      ) : (
        <>
          <p className="hint">{install.info.platform.startsWith('ios') ? WHY_IOS : WHY}</p>
          {install.canPrompt ? (
            <button type="button" className="btn btn-quiet btn-block" onClick={() => void install.install()}>
              התקנה
            </button>
          ) : (
            <InstallSteps info={install.info} />
          )}
        </>
      )}
    </div>
  );
}

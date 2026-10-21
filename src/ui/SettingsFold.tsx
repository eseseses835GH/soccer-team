import { useState, type ReactNode } from 'react';
import { loadJSON, saveJSON } from '../state/storage';

/** Which Settings folds are open on this phone (never synced, not in the backup). */
const OPEN_KEY = 'kochot:settings-open';

/** Open a fold before navigating to Settings (used by links from the help screen). */
export function openSettingsFold(id: string) {
  if (!openIds().includes(id)) saveJSON(OPEN_KEY, [...openIds(), id]);
  saveJSON(CLOSED_KEY, closedIds().filter((x) => x !== id));
}

/** Folds that start open, once someone closed them (remembered the same way). */
const CLOSED_KEY = 'kochot:settings-closed';

function ids(key: string): string[] {
  const v = loadJSON<unknown>(key);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
const openIds = () => ids(OPEN_KEY);
const closedIds = () => ids(CLOSED_KEY);

/**
 * A Settings section that folds: "גופיות · אין". Closed by default (`startOpen` for the
 * essentials); what each phone opened or closed is remembered.
 */
export function SettingsFold({ id, title, value, startOpen, children }: { id: string; title: string; value?: ReactNode; startOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => openIds().includes(id) || (!!startOpen && !closedIds().includes(id)));
  return (
    <details
      id={`set-${id}`}
      className="group fold settings-fold"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        const opened = openIds().filter((x) => x !== id);
        const closed = closedIds().filter((x) => x !== id);
        saveJSON(OPEN_KEY, now ? [...opened, id] : opened);
        saveJSON(CLOSED_KEY, now ? closed : [...closed, id]);
      }}
    >
      <summary>
        <span className="fold-title">{title}</span>
        {value !== undefined && value !== '' && <small className="fold-value">· {value}</small>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

import { useState, type ReactNode } from 'react';
import { loadJSON, saveJSON } from '../state/storage';

/** Which Settings folds are open on this phone (never synced, not in the backup). */
const OPEN_KEY = 'kochot:settings-open';

function openIds(): string[] {
  const v = loadJSON<unknown>(OPEN_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * A Settings section that folds: "גופיות · אין". Closed by default; the open ones are
 * remembered per phone.
 */
export function SettingsFold({ id, title, value, children }: { id: string; title: string; value?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => openIds().includes(id));
  return (
    <details
      className="group fold settings-fold"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        const rest = openIds().filter((x) => x !== id);
        saveJSON(OPEN_KEY, now ? [...rest, id] : rest);
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

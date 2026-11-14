import { useEffect, useState } from 'react';
import { goalsEvery } from '../i18n';
import { rotation } from '../match/match';
import type { TeamLook } from '../state/model';
import { loadJSON, saveJSON } from '../state/storage';
import { Sheet } from './components';

/** Remembered per phone: the order sheet already opened by itself once. */
const SEEN_KEY = 'kochot:gk-order-seen';

export interface GkTeam {
  look: TeamLook;
  /** The team in keeper order (everyone, incl. players marked "לא בשער"). */
  ids: string[];
  /** In goal now (only while a match is on). */
  keeper?: string | null;
}

/** Open the sheet by itself the first time teams are seen on this phone (rotating keepers only). */
export function useGkOrderSheet(enabled: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (enabled && !loadJSON<boolean>(SEEN_KEY)) setOpen(true);
  }, [enabled]);
  return [
    open,
    (v: boolean) => {
      if (!v) saveJSON(SEEN_KEY, true);
      setOpen(v);
    },
  ];
}

export function GkOrderButton({ onClick }: { onClick: () => void }) {
  return (
    <p className="gk-order-row">
      <button type="button" className="btn btn-small btn-quiet gk-order-btn" onClick={onClick}>
        🧤 סדר שוערים
      </button>
    </p>
  );
}

/** "סדר שוערים": each team's turns in goal, 1, 2, 3… With `onSwap`, tapping two players swaps them. */
export function GkOrderSheet({
  teams,
  name,
  every,
  noGK,
  onSwap,
  onClose,
}: {
  teams: GkTeam[];
  name: (id: string) => string;
  every: number;
  noGK: ReadonlySet<string>;
  onSwap?: (team: number, a: string, b: string) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<{ t: number; id: string } | null>(null);
  const tap = (t: number, id: string) => {
    if (!onSwap) return;
    if (!sel || sel.t !== t) return setSel({ t, id });
    if (sel.id !== id) onSwap(t, sel.id, id);
    setSel(null);
  };
  return (
    <Sheet title="סדר שוערים" onClose={onClose}>
      <p className="hint">מתחלפים אחרי {goalsEvery(every)}</p>
      <div className="gk-teams">
        {teams.map((team, t) => {
          const order = rotation(team.ids, noGK);
          const out = team.ids.filter((id) => !order.includes(id));
          return (
            <section key={t} className="gk-team" style={{ '--team': team.look.color } as React.CSSProperties} aria-label={team.look.the}>
              <h3>
                <span className="dot" aria-hidden="true" /> {team.look.name}
              </h3>
              <ol>
                {order.map((id, i) => {
                  const on = sel?.t === t && sel.id === id;
                  const label = (
                    <>
                      <span className="slot">{i + 1}</span>
                      <span className="name">{name(id)}</span>
                      {team.keeper === id && <span aria-label="בשער עכשיו">🧤</span>}
                    </>
                  );
                  return (
                    <li key={id}>
                      {onSwap ? (
                        <button type="button" className={`member ${on ? 'sel' : ''}`} aria-pressed={on} onClick={() => tap(t, id)}>
                          {label}
                        </button>
                      ) : (
                        <span className="member">{label}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {out.length > 0 && <p className="hint small gk-out">לא בשער: {out.map(name).join(', ')}</p>}
            </section>
          );
        })}
      </div>
      {onSwap && <p className="hint small center">{sel ? 'עם מי להחליף?' : 'להחלפה: נוגעים בשניים'}</p>}
    </Sheet>
  );
}

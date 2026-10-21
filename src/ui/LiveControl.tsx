// An organizer's phone while another phone runs tonight (DECISIONS → "Match runner handoff —
// organizer side (v12)"): the live evening read-only, one line saying whose phone runs it, and one
// button to take it back (everything played meanwhile comes along).
import { useEffect, useState } from 'react';
import { eveningId, hasEveningData } from '../state/history';
import { useGroups, useStore } from '../state/store';
import { useLiveControl } from '../sync/OrganizerSync';
import type { TakeResult } from '../sync/organizerControl';
import { useUi } from './App';
import { Sheet } from './components';
import { LiveView } from './PlayerHome';

const FAIL: Record<Exclude<TakeResult, 'ok'>, string> = { ended: 'הערב כבר הסתיים', offline: 'אין חיבור, נסו שוב' };

export const runnerLine = (name: string) => (name ? `מנוהל מהטלפון של ${name}` : 'אף טלפון לא מנהל את הערב');

/** "סיום הערב": takes control first when another phone runs it, then ends it here. */
export function useEndEvening() {
  const ctl = useLiveControl();
  const groups = useGroups();
  const { dispatch } = useStore();
  const { go, notify } = useUi();
  return async () => {
    const res = await ctl.ensureRunner();
    if (res !== 'ok') return notify(FAIL[res]);
    const { app } = groups.latest();
    if (!app.result) return;
    const id = eveningId(app.result);
    const saved = hasEveningData(app.match, Date.now());
    dispatch({ type: 'endEvening', id, now: Date.now() });
    if (saved) go('evening', id);
    else go('teams');
  };
}

/** Teams and match screens while another phone runs the evening. */
export function ViewerScreen() {
  const { viewer, takeBack } = useLiveControl();
  const { state } = useStore();
  const groups = useGroups();
  const { go, notify } = useUi();
  const endEvening = useEndEvening();
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!viewer) return null;

  const take = async () => {
    setBusy(true);
    const res = await takeBack();
    setBusy(false);
    if (res !== 'ok') return notify(FAIL[res]);
    go(groups.latest().app.match ? 'match' : 'teams');
  };
  const end = async () => {
    setConfirmEnd(false);
    setBusy(true);
    await endEvening();
    setBusy(false);
  };

  return (
    <section className="viewer" aria-label="הערב">
      <div className="viewer-bar">
        <p>{runnerLine(viewer.runnerName)}</p>
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={take}>
          לקחת את הניהול בחזרה
        </button>
      </div>
      <LiveView data={viewer.data} roster={state.players} me={null} now={now} />
      <div className="row-links">
        <button type="button" className="text-btn danger" disabled={busy} onClick={() => setConfirmEnd(true)}>
          סיום הערב
        </button>
      </div>
      {confirmEnd && (
        <Sheet title="לסיים את הערב?" onClose={() => setConfirmEnd(false)}>
          <p className="lead">הניהול עובר לטלפון הזה, והסיכום נשמר בערבים הקודמים.</p>
          <div className="stack">
            <button type="button" className="btn btn-danger btn-block" onClick={end}>
              סיום הערב
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => setConfirmEnd(false)}>
              ביטול
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

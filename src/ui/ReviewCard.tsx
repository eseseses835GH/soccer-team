// "איך שיחקו הערב?" (v37): on the home screen for 48 hours after an evening he played; a sheet
// with everyone else who played and one tap each. DECISIONS → "v37: after-game review".
import { useEffect, useRef, useState } from 'react';
import type { EveningRecord } from '../state/history';
import { Avatar } from '../photos/Avatar';
import { markReview, reviewable, reviewList, reviewMark, reviewPayload, reviewsApi, type Review, type ReviewValue } from '../sync/reviews';
import { SyncError } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { useUi } from './App';
import { Sheet } from './components';

const CHOICES: { v: ReviewValue | null; label: string }[] = [
  { v: -1, label: 'פחות טוב' },
  { v: 0, label: 'כרגיל' },
  { v: 1, label: 'יותר טוב' },
  { v: null, label: 'לא יודע' },
];

export function ReviewCard({
  groupId,
  history,
  me,
  roster,
}: {
  groupId: string;
  history: EveningRecord[];
  /** My claimed roster player (null = none: no card). */
  me: string | null;
  roster: { id: string; name: string; photo?: string }[];
}) {
  const [, rerender] = useState(0);
  const [open, setOpen] = useState(false);
  const ev = reviewable(history, me, Date.now(), (id) => reviewMark(groupId, id) === 'later');
  if (!ev || !me) return null;
  const sent = reviewMark(groupId, ev.id) === 'sent';
  return (
    <>
      <div className="rate-card review-card">
        <p>
          <strong>איך שיחקו הערב?</strong>
        </p>
        <div className="review-card-actions">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              markReview(groupId, ev.id, 'later');
              rerender((n) => n + 1);
            }}
          >
            אחר כך
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setOpen(true)}>
            {sent ? 'לעדכן' : 'לדרג'}
          </button>
        </div>
      </div>
      {open && (
        <ReviewSheet
          groupId={groupId}
          ev={ev}
          me={me}
          roster={roster}
          onClose={() => setOpen(false)}
          onSent={() => {
            markReview(groupId, ev.id, 'sent');
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ReviewSheet({
  groupId,
  ev,
  me,
  roster,
  onClose,
  onSent,
}: {
  groupId: string;
  ev: EveningRecord;
  me: string;
  roster: { id: string; name: string; photo?: string }[];
  onClose: () => void;
  onSent: () => void;
}) {
  const sync = useSync();
  const { notify } = useUi();
  const list = reviewList(ev, me, roster);
  const [review, setReview] = useState<Review>({});
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  // What I already sent for this evening (changing it is fine for 48 hours).
  useEffect(() => {
    let off = false;
    void (async () => {
      try {
        const mine = await reviewsApi(await sync.client()).myReview(groupId, ev.id);
        if (!off && !touched.current) setReview(mine);
      } catch {
        /* start empty */
      }
    })();
    return () => {
      off = true;
    };
  }, [groupId, ev.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string, v: ReviewValue | null) => {
    touched.current = true;
    setReview((r) => {
      const { [id]: _, ...rest } = r;
      return v === null ? rest : { ...rest, [id]: v };
    });
  };
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reviewsApi(await sync.client()).reviewEvening(groupId, ev.id, reviewPayload(review, list.map((p) => p.id)));
      notify('תודה!');
      onSent();
    } catch (e) {
      const c = e instanceof SyncError ? e.code : 'other';
      notify(c === 'offline' ? 'אין חיבור לאינטרנט' : c === 'denied' ? 'אי אפשר לדרג את הערב הזה' : 'משהו השתבש, נסו שוב');
      setBusy(false);
    }
  };
  const photo = (id: string) => roster.find((p) => p.id === id)?.photo;
  return (
    <Sheet title="איך שיחקו הערב?" onClose={onClose}>
      <ul className="review-list">
        {list.map((p) => (
          <li key={p.id}>
            <span className="review-who">
              <Avatar player={{ id: p.id, name: p.name, photo: photo(p.id) }} size={28} />
              {p.name}
            </span>
            <div className="review-chips" role="radiogroup" aria-label={p.name}>
              {CHOICES.map((c) => {
                const on = (review[p.id] ?? null) === c.v;
                return (
                  <button key={c.label} type="button" role="radio" aria-checked={on} className={`card-chip ${on ? 'on' : ''}`} onClick={() => pick(p.id, c.v)}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void send()}>
        שליחה
      </button>
    </Sheet>
  );
}

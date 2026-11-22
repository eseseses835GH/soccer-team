// The rating survey: one player at a time, 1–10 or skip. Each tap is sent at once, so closing
// midway loses nothing; coming back opens at the first one not rated yet. "הקודם" goes back one,
// "כל השחקנים" lists everyone with my vote and jumps to whoever is tapped.
import { useMemo, useState } from 'react';
import { surveyList, surveyStart } from '../sync/playerGroup';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
import { Avatar } from '../photos/Avatar';
import { useUi } from './App';
import { Empty } from './components';
import { ClaimView } from './PlayerHome';

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function RateScreen() {
  const pg = usePlayerGroup();
  const { go, notify } = useUi();
  const list = useMemo(() => (pg.pub ? surveyList(pg.pub) : []), [pg.pub]);
  // Where to start is decided once, when the survey opens with my votes loaded.
  const [i, setI] = useState<number | null>(null);
  const at = i ?? surveyStart(list, pg.votes);
  const [all, setAll] = useState(false);

  if (!pg.pub?.me.canRate) return <Empty icon="🔒" title="הדירוג סגור" />;
  if (!pg.pub.me.playerId) return <ClaimView onDone={() => setI(null)} />;
  if (all) {
    return (
      <section className="rate" aria-label="כל השחקנים">
        <ul className="pick-list rate-all">
          {list.map((q, k) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => {
                  setI(k);
                  setAll(false);
                }}
              >
                <Avatar player={q} size={36} />
                <span className="name">{q.name}</span>
                <span className="level">{pg.votes[q.id] ?? '–'}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-quiet btn-block" onClick={() => setAll(false)}>
          חזרה
        </button>
      </section>
    );
  }
  if (at >= list.length) {
    return (
      <Empty icon="🙏" title="תודה!">
        <div className="stack narrow">
          <button type="button" className="btn btn-primary btn-block" onClick={() => go('home')}>
            סיום
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setAll(true)}>
            כל השחקנים
          </button>
        </div>
      </Empty>
    );
  }

  const p = list[at];
  const mine = pg.votes[p.id];
  const pick = async (level: number) => {
    setI(at + 1);
    if (!(await pg.vote(p.id, level))) {
      notify('הדירוג לא נשמר, נסו שוב');
      setI(at);
    }
  };

  return (
    <section className="rate" aria-label="דירוג">
      <p className="rate-progress" dir="ltr">
        {at + 1}/{list.length}
      </p>
      <Avatar player={p} size={88} />
      <h1 className="rate-name">{p.name}</h1>
      <div className="rate-levels" role="radiogroup" aria-label={`רמה של ${p.name}`}>
        {LEVELS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={mine === n} className={mine === n ? 'on' : ''} onClick={() => void pick(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="row-2">
        <button type="button" className="btn btn-quiet" disabled={at === 0} onClick={() => setI(at - 1)}>
          הקודם
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setI(at + 1)}>
          דילוג
        </button>
      </div>
      <p className="hint small center">הדירוג אנונימי ונכנס לממוצע</p>
      <div className="row-links">
        <button type="button" className="text-btn" onClick={() => setAll(true)}>
          כל השחקנים
        </button>
        <button type="button" className="text-btn" onClick={() => go('home')}>
          סיום
        </button>
      </div>
    </section>
  );
}

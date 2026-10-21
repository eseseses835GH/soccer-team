// The rating survey: one player at a time, 1–10 or skip. Each tap is sent at once, so closing
// midway loses nothing; coming back opens at the first one not rated yet.
import { useMemo, useState } from 'react';
import { surveyList, surveyStart } from '../sync/playerGroup';
import { usePlayerGroup } from '../sync/PlayerGroupProvider';
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

  if (!pg.pub?.me.canRate) return <Empty icon="🔒" title="הדירוג סגור" />;
  if (!pg.pub.me.playerId) return <ClaimView onDone={() => setI(null)} />;
  if (at >= list.length) {
    return (
      <Empty icon="🙏" title="תודה!">
        <div className="stack narrow">
          <button type="button" className="btn btn-primary btn-block" onClick={() => go('home')}>
            סיום
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
      <h1 className="rate-name">{p.name}</h1>
      <div className="rate-levels" role="radiogroup" aria-label={`רמה של ${p.name}`}>
        {LEVELS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={mine === n} className={mine === n ? 'on' : ''} onClick={() => void pick(n)}>
            {n}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-quiet btn-block" onClick={() => setI(at + 1)}>
        דילוג
      </button>
      <p className="hint small center">הדירוג אנונימי ונכנס לממוצע</p>
      <div className="row-links">
        <button type="button" className="text-btn" onClick={() => go('home')}>
          סיום
        </button>
      </div>
    </section>
  );
}

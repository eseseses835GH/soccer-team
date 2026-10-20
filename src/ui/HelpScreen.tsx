import { useEffect, useRef, useState } from 'react';
import { useUi } from './App';
import { InstallHelp } from './InstallPrompt';
import { searchHelp, type HelpItem, type LegendMark } from './help';
import { Icon } from './icons';

function Mark({ mark }: { mark: LegendMark }) {
  if ('dot' in mark) return <span className={`sync-dot tone-${mark.dot}`} />;
  if ('icon' in mark) return <Icon name={mark.icon} size={20} />;
  if ('emoji' in mark) return <span className="legend-emoji">{mark.emoji}</span>;
  return (
    <span className="legend-text" dir={mark.ltr ? 'ltr' : undefined}>
      {mark.text}
    </span>
  );
}

function Question({ item, open }: { item: HelpItem; open: boolean }) {
  return (
    <details className="fold help-q" id={`help-${item.id}`} open={open}>
      <summary>{item.q}</summary>
      <div className="help-a">
        {item.a?.map((p) => <p key={p}>{p}</p>)}
        {item.legend && (
          <ul className="legend">
            {item.legend.map((r) => (
              <li key={r.name}>
                <span className="legend-mark" aria-hidden="true">
                  <Mark mark={r.mark} />
                </span>
                <span>
                  <strong>{r.name}</strong>
                  {r.text && <span className="muted"> · {r.text}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {item.install && <InstallHelp />}
      </div>
    </details>
  );
}

/** "שאלות ותשובות". `focus` (from `#help/<id>`) opens that question and scrolls to it. */
export function HelpScreen({ focus }: { focus: string }) {
  const [query, setQuery] = useState('');
  const sections = searchHelp(query);
  const searching = query.trim() !== '';
  const first = useRef(true);

  useEffect(() => {
    if (!focus || !first.current) return;
    first.current = false;
    document.getElementById(`help-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus]);

  return (
    <section className="help" aria-label="שאלות ותשובות">
      <input className="search help-search" type="search" placeholder="חיפוש: פנדלים, שוער, גיבוי…" aria-label="חיפוש בשאלות" value={query} onChange={(e) => setQuery(e.target.value)} />
      {sections.map((s) => (
        <div key={s.id} className="help-section">
          <h2>{s.title}</h2>
          {s.items.map((i) => (
            // Remounting while searching opens every match; otherwise each fold keeps its own state.
            <Question key={searching ? `s-${i.id}` : i.id} item={i} open={searching || i.id === focus} />
          ))}
        </div>
      ))}
      {!sections.length && <p className="hint center">לא מצאנו שאלה כזו. נסו מילה אחרת.</p>}
    </section>
  );
}

/** The row at the top of Settings. */
export function HelpLink() {
  const { go } = useUi();
  return (
    <button type="button" className="help-link" onClick={() => go('help')}>
      <Icon name="help" size={20} />
      <span>
        <strong>שאלות ותשובות</strong>
        <small className="muted">מה אומרים האייקונים, איך מתחלקות הקבוצות ועוד</small>
      </span>
    </button>
  );
}

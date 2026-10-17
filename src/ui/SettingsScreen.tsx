import { useState } from 'react';
import { ATTR_KEYS, type Constraints } from '../engine';
import { ATTR_LABELS } from '../i18n';
import { useStore } from '../state/store';
import { useUi } from './App';
import { RatingSlider } from './components';

export function SettingsScreen() {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const { settings, constraints, players } = state;
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [kind, setKind] = useState<keyof Constraints>('together');
  const [confirmClear, setConfirmClear] = useState(false);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const sorted = [...players].sort((x, y) => x.name.localeCompare(y.name, 'he'));

  const addPair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!a || !b) return notify('בחרו שני שחקנים');
    if (a === b) return notify('צריך שני שחקנים שונים');
    dispatch({ type: 'addConstraint', kind, pair: [a, b] });
    setA('');
    setB('');
    notify('האילוץ נוסף');
  };

  return (
    <section aria-labelledby="settings-h">
      <div className="section-head">
        <h2 id="settings-h">הגדרות</h2>
      </div>

      <div className="card">
        <h3>אילוצים</h3>
        <p className="hint">״יחד״ – תמיד באותה קבוצה (למשל מגיעים ביחד). ״בנפרד״ – אף פעם לא באותה קבוצה.</p>
        {players.length < 2 ? (
          <p className="muted">צריך לפחות שני שחקנים כדי להוסיף אילוץ.</p>
        ) : (
          <form className="pair-form" onSubmit={addPair}>
            <div className="segmented" role="radiogroup" aria-label="סוג אילוץ">
              {(['together', 'apart'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {k === 'together' ? '🤝 יחד' : '↔️ בנפרד'}
                </button>
              ))}
            </div>
            <div className="row">
              <select className="input" aria-label="שחקן ראשון" value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">שחקן…</option>
                {sorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="input" aria-label="שחקן שני" value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">שחקן…</option>
                {sorted
                  .filter((p) => p.id !== a)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block">
              הוספת אילוץ
            </button>
          </form>
        )}
        {(['together', 'apart'] as const).map((k) =>
          constraints[k].length ? (
            <ul key={k} className="pair-list" aria-label={k === 'together' ? 'יחד' : 'בנפרד'}>
              {constraints[k].map(([x, y], i) => (
                <li key={`${x}-${y}`}>
                  <span>
                    {k === 'together' ? '🤝' : '↔️'} {nameOf(x)} {k === 'together' ? 'עם' : 'בלי'} {nameOf(y)}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`הסרת האילוץ ${nameOf(x)} ו${nameOf(y)}`}
                    onClick={() => dispatch({ type: 'removeConstraint', kind: k, index: i })}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null,
        )}
      </div>

      <div className="card">
        <h3>משקל התכונות באיזון</h3>
        <p className="hint">כמה כל תכונה חשובה כשמשווים בין הקבוצות. 0 = להתעלם.</p>
        <div className="sliders">
          {ATTR_KEYS.map((k) => (
            <RatingSlider
              key={k}
              label={ATTR_LABELS[k]}
              min={0}
              max={5}
              step={0.5}
              value={settings.weights[k]}
              onChange={(v) => dispatch({ type: 'setSettings', settings: { ...settings, weights: { ...settings.weights, [k]: v } } })}
            />
          ))}
        </div>
        <h3>מנהיגות</h3>
        <p className="hint">שחקן עם מנהיגות מהרמה הזו ומעלה נחשב ״מנהיג״. כל קבוצה תקבל מנהיג אם אפשר.</p>
        <RatingSlider
          label="סף מנהיג"
          value={settings.leadershipThreshold}
          onChange={(v) => dispatch({ type: 'setSettings', settings: { ...settings, leadershipThreshold: v } })}
        />
        <button type="button" className="btn btn-secondary btn-block" onClick={() => dispatch({ type: 'resetSettings' })}>
          איפוס לברירת המחדל
        </button>
      </div>

      <div className="card">
        <h3>נתונים</h3>
        <p className="hint">הכול נשמר רק בדפדפן הזה, בלי הרשמה ובלי שרת.</p>
        <div className="stack">
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => {
              dispatch({ type: 'loadSample' });
              notify('סגל לדוגמה נטען');
            }}
          >
            טעינת סגל לדוגמה
          </button>
          {confirmClear ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                dispatch({ type: 'clearAll' });
                setConfirmClear(false);
                notify('כל הנתונים נמחקו');
              }}
            >
              בטוח? למחוק הכול
            </button>
          ) : (
            <button type="button" className="btn btn-ghost-danger btn-block" onClick={() => setConfirmClear(true)}>
              מחיקת כל הנתונים
            </button>
          )}
        </div>
      </div>

      <div className="card about">
        <h3>איך זה עובד?</h3>
        <p>
          כל שחקן הוא אוסף דירוגים. המערכת בודקת את כל החלוקות האפשריות (או מחפשת חכם כשיש הרבה שחקנים) ובוחרת את
          זו שבה הממוצעים של הקבוצות הכי קרובים, תוך דאגה לשוער ולמנהיג בכל קבוצה ולאילוצים שהגדרתם.
        </p>
      </div>
    </section>
  );
}

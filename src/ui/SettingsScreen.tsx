import { useState } from 'react';
import { ATTR_KEYS, type Constraints } from '../engine';
import { ATTR_LABELS } from '../i18n';
import { IMPORT_HASH, encodeBackup, makeBackup } from '../state/io';
import { ACCENTS, BIBS, type BibId } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { STATUS_TEXT, useSync } from '../sync/SyncProvider';
import { copyText, downloadText, nativeShare } from '../share';
import { useUi } from './App';
import { RatingSlider, Segmented, Stepper } from './components';
import { Icon } from './icons';

export function SettingsScreen() {
  const { state, dispatch } = useStore();
  const { notify } = useUi();
  const { settings, constraints, players } = state;
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [kind, setKind] = useState<keyof Constraints>('apart');
  const [confirmClear, setConfirmClear] = useState(false);
  const sync = useSync();
  const { current } = useGroups();
  const set = (patch: Partial<typeof settings>) => dispatch({ type: 'setSettings', settings: { ...settings, ...patch } });

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const sorted = [...players].sort((x, y) => x.name.localeCompare(y.name, 'he'));

  const toggleBib = (id: BibId) => {
    const has = settings.bibs.includes(id);
    if (has && settings.bibs.length <= 2) return notify('צריך לפחות שני צבעים');
    set({ bibs: has ? settings.bibs.filter((x) => x !== id) : [...settings.bibs, id] });
  };

  const addPair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!a || !b || a === b) return notify('בחרו שני שחקנים שונים');
    dispatch({ type: 'addConstraint', kind, pair: [a, b] });
    setA('');
    setB('');
  };

  const backup = () => makeBackup(players, constraints, settings);
  const sendLink = async () => {
    const url = `${location.origin}${location.pathname}${IMPORT_HASH}${await encodeBackup(backup())}`;
    if (await nativeShare({ title: 'הסגל של כוחות', url })) return;
    notify((await copyText(url)) ? 'הקישור הועתק' : 'ההעתקה נכשלה');
  };

  return (
    <section className="settings" aria-label="הגדרות">
      <div className="group">
        <h2>שוערים</h2>
        <Segmented
          label="שוערים"
          value={settings.gkMode}
          onChange={(gkMode) => set({ gkMode })}
          options={[
            { value: 'rotate', label: 'מתחלפים' },
            { value: 'fixed', label: 'שוער קבוע' },
          ]}
        />
        {settings.gkMode === 'rotate' ? (
          <>
            <p className="hint">כל קבוצה מקבלת סדר שוערים מוגרל. מתחלפים לפי מספר הגולים שספגו.</p>
            <div className="field-row">
              <span>מתחלפים כל</span>
              <Segmented
                label="מתחלפים כל"
                value={settings.gkSwitchGoals}
                onChange={(gkSwitchGoals) => set({ gkSwitchGoals })}
                options={[
                  { value: 1, label: 'גול' },
                  { value: 2, label: '2 גולים' },
                  { value: 3, label: '3' },
                ]}
              />
            </div>
          </>
        ) : (
          <p className="hint">מסמנים בכרטיס השחקן ״שוער קבוע״, ואם יש מספיק, כל קבוצה מקבלת אחד.</p>
        )}
      </div>

      <div className="group">
        <h2>משחק</h2>
        <div className="field-row">
          <span>אורך משחק</span>
          <Stepper label="אורך משחק בדקות" value={settings.matchMinutes} min={1} max={60} onChange={(matchMinutes) => set({ matchMinutes })} suffix="דק׳" />
        </div>
      </div>

      <div className="group">
        <h2>גופיות</h2>
        <p className="hint">מסמנים את הצבעים שיש לכם. הקבוצות מקבלות אותם לפי הסדר שסימנתם.</p>
        <div className="bibs">
          {BIBS.map((bib) => {
            const idx = settings.bibs.indexOf(bib.id);
            return (
              <button
                key={bib.id}
                type="button"
                className={`bib ${idx >= 0 ? 'on' : ''}`}
                aria-pressed={idx >= 0}
                onClick={() => toggleBib(bib.id)}
                style={{ '--team': bib.color } as React.CSSProperties}
              >
                <span className="swatch" aria-hidden="true" />
                {bib.name}
                {idx >= 0 && <span className="order">{idx + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="group">
        <h2>מראה</h2>
        <Segmented
          label="מצב תצוגה"
          value={settings.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'light', label: 'בהיר' },
            { value: 'dark', label: 'כהה' },
            { value: 'auto', label: 'לפי הטלפון' },
          ]}
        />
        <p className="hint">צבע ראשי (כפתורים, סימוני נוכחות וציון האיזון):</p>
        <div className="bibs" role="radiogroup" aria-label="צבע ראשי">
          {ACCENTS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              className={`bib ${settings.accent === c.id ? 'on' : ''}`}
              aria-checked={settings.accent === c.id}
              onClick={() => set({ accent: c.id })}
              style={{ '--team': c.swatch } as React.CSSProperties}
            >
              <span className="swatch" aria-hidden="true" />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h2>זוגות</h2>
        <p className="hint">״בנפרד״ – אף פעם לא באותה קבוצה (למשל שני האחים). ״יחד״ – תמיד ביחד (למשל באים באותו אוטו).</p>
        {players.length < 2 ? (
          <p className="muted">צריך לפחות שני שחקנים.</p>
        ) : (
          <form className="pair-form" onSubmit={addPair}>
            <Segmented
              label="סוג"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'apart', label: 'בנפרד' },
                { value: 'together', label: 'יחד' },
              ]}
            />
            <div className="row-2">
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
            <button type="submit" className="btn btn-quiet btn-block">
              הוספת זוג
            </button>
          </form>
        )}
        {(['apart', 'together'] as const).map((k) =>
          constraints[k].length ? (
            <ul key={k} className="pairs">
              {constraints[k].map(([x, y], i) => (
                <li key={`${x}-${y}`}>
                  <span>
                    {nameOf(x)} {k === 'together' ? 'יחד עם' : 'בנפרד מ'}
                    {k === 'together' ? ' ' : ''}
                    {nameOf(y)}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`הסרה: ${nameOf(x)} ו${nameOf(y)}`} onClick={() => dispatch({ type: 'removeConstraint', kind: k, index: i })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null,
        )}
      </div>

      {sync.configured && (
        <div className="group account">
          <h2>חשבון וסנכרון</h2>
          {sync.email ? (
            <>
              <p className="account-who">
                מחוברים בתור <bdi dir="ltr">{sync.email}</bdi>
              </p>
              <p className="hint">
                ״{current.name}״: {current.synced ? STATUS_TEXT[sync.status] : 'בטלפון הזה בלבד. אפשר לסנכרן אותה מתפריט הקבוצות (שם הקבוצה למעלה במסך הראשי).'}
              </p>
              <div className="stack">
                {current.synced && (
                  <button type="button" className="btn btn-quiet btn-block" onClick={sync.syncNow}>
                    סנכרון עכשיו
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-block" onClick={() => void sync.signOut()}>
                  יציאה מהחשבון
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">בלי חשבון הכול נשמר רק בטלפון הזה. עם חשבון אפשר לסנכרן קבוצה בין כמה מארגנים ולהזמין מארגנים נוספים.</p>
              <button type="button" className="btn btn-quiet btn-block" onClick={() => sync.openLogin('account')}>
                התחברות
              </button>
            </>
          )}
        </div>
      )}

      <div className="group">
        <h2>גיבוי ושיתוף הסגל</h2>
        <p className="hint">
          {current.synced ? 'הקבוצה מסונכרנת עם החשבון. ' : 'הכול נשמר רק בטלפון הזה. '}
          כדאי לשמור גיבוי, או לשלוח קישור למארגן נוסף. שימו לב: הקישור והקובץ כוללים את הדירוגים.
        </p>
        <div className="stack">
          <button type="button" className="btn btn-quiet btn-block" disabled={!players.length} onClick={sendLink}>
            <Icon name="link" size={20} /> שליחת קישור למארגן נוסף
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-block"
            disabled={!players.length}
            onClick={() => downloadText(`kochot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup(), null, 1), 'application/json')}
          >
            <Icon name="download" size={20} /> הורדת קובץ גיבוי
          </button>
        </div>
        <p className="hint small">שחזור מקובץ: במסך השחקנים, ״ייבוא רשימה״.</p>
      </div>

      <details className="group fold">
        <summary>מתקדם: משקלים באיזון</summary>
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
              onChange={(v) => set({ weights: { ...settings.weights, [k]: v } })}
            />
          ))}
        </div>
        <RatingSlider label="סף ״מנהיג״" value={settings.leadershipThreshold} onChange={(leadershipThreshold) => set({ leadershipThreshold })} />
        <p className="hint small">כל קבוצה תקבל מנהיג (מנהיגות מהרמה הזו ומעלה), אם יש מספיק.</p>
        <button type="button" className="btn btn-quiet btn-block" onClick={() => dispatch({ type: 'resetWeights' })}>
          חזרה לברירת המחדל
        </button>
      </details>

      <div className="group">
        <h2>נתונים</h2>
        {current.synced && <p className="hint">הקבוצה מסונכרנת: מחיקה כאן תמחק את השחקנים גם אצל שאר המארגנים.</p>}
        <div className="stack">
          <button type="button" className="btn btn-quiet btn-block" onClick={() => dispatch({ type: 'loadSample', now: Date.now() })}>
            טעינת סגל לדוגמה
          </button>
          {confirmClear ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                dispatch({ type: 'clearAll' });
                setConfirmClear(false);
                notify('הכול נמחק');
              }}
            >
              בטוח? למחוק הכול
            </button>
          ) : (
            <button type="button" className="btn btn-quiet danger btn-block" onClick={() => setConfirmClear(true)}>
              מחיקת כל הנתונים
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

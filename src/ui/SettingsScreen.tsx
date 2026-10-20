import { useState } from 'react';
import { ATTR_KEYS, type Constraints } from '../engine';
import { ATTR_LABELS, goalsEvery } from '../i18n';
import { IMPORT_HASH, encodeBackup, makeBackup } from '../state/io';
import { ACCENTS, BIBS, teamLook, type BibId } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { STATUS_TEXT, useSync } from '../sync/SyncProvider';
import { copyText, downloadText, nativeShare } from '../share';
import { useUi } from './App';
import { RatingSlider, Segmented, Stepper, Toggle } from './components';
import { Icon } from './icons';
import { HelpLink } from './HelpScreen';
import { SettingsFold } from './SettingsFold';

const RULE_LABEL = { apart: 'לא באותה קבוצה', together: 'תמיד באותה קבוצה' } as const;

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

  const ruleCount = constraints.together.length + constraints.apart.length;
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
      <HelpLink />
      <div className="group">
        <h2>משחק</h2>
        <div className="field-row">
          <span>אורך משחק</span>
          <Stepper label="אורך משחק בדקות" value={settings.matchMinutes} min={1} max={60} onChange={(matchMinutes) => set({ matchMinutes })} suffix="דק׳" />
        </div>
        <Toggle
          label="בלי טיימר"
          hint="השעון סופר קדימה ולא שורק בסוף הזמן. אפשר לשנות גם מהשעון במסך המשחק."
          checked={settings.matchNoLimit}
          onChange={(matchNoLimit) => set({ matchNoLimit })}
        />
        <div className="field-row">
          <span>תוספת זמן בתיקו</span>
          <Segmented
            label="תוספת זמן בתיקו"
            value={settings.drawExtraMinutes}
            onChange={(drawExtraMinutes) => set({ drawExtraMinutes })}
            options={[
              { value: 0, label: 'בלי' },
              { value: 1, label: '1' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
              { value: 5, label: '5' },
            ]}
          />
        </div>
        <p className="hint">כשהזמן נגמר בתיקו: שריקה, והמשחק ממשיך בתוספת זמן (פעם אחת). אחרי זה, אם עדיין תיקו, מחליטים בפנדלים.</p>
        <p className="hint">צלילים:</p>
        <Segmented
          label="צלילים"
          value={settings.goalSound}
          onChange={(goalSound) => set({ goalSound })}
          options={[
            { value: 'on', label: 'פועל' },
            { value: 'off', label: 'כבוי' },
          ]}
        />
        <p className="hint small">שריקת שופט בפתיחה ובסיום, וצופר כשמבקיעים גול. אפשר להשתיק גם ממסך המשחק.</p>
      </div>


      <SettingsFold id="gk" title="שוערים" value={settings.gkMode === 'fixed' ? 'שוער קבוע' : `מתחלפים ${goalsEvery(settings.gkSwitchGoals)}`}>
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
          <p className="hint">מסמנים בכרטיס השחקן 🧤 ״טוב בשער״, ואם יש מספיק, כל קבוצה מקבלת אחד כזה שעומד בשער כל המשחק.</p>
        )}
      </SettingsFold>

      <SettingsFold id="bibs" title="גופיות" value={settings.hasBibs ? `${settings.bibs.length} צבעים` : 'אין'}>
        <Toggle
          label="יש לכם גופיות?"
          hint={settings.hasBibs ? 'הקבוצות נקראות לפי צבע הגופיות.' : 'בלי גופיות הקבוצות נקראות לפי מספר, וכל אחת מקבלת צבע משלה במסך:'}
          checked={settings.hasBibs}
          onChange={(hasBibs) => set({ hasBibs })}
        />
        {settings.hasBibs ? (
          <>
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
          </>
        ) : (
          <p className="team-preview" aria-hidden="true">
            {[0, 1, 2].map((t) => (
              <span key={t} style={{ '--team': teamLook(settings, t).color } as React.CSSProperties}>
                <span className="dot" /> {teamLook(settings, t).name}
              </span>
            ))}
          </p>
        )}
      </SettingsFold>

      <SettingsFold id="rules" title="מי עם מי" value={ruleCount ? String(ruleCount) : 'אין'}>
        <p className="hint">אפשר לבקש שני שחקנים שתמיד יהיו בקבוצות שונות, או תמיד באותה קבוצה. החלוקה תשמור על זה.</p>
        <ul className="rule-examples">
          <li>
            <strong>לא באותה קבוצה</strong>: למשל שני אחים שתמיד רבים, או שני השוערים.
          </li>
          <li>
            <strong>תמיד באותה קבוצה</strong>: למשל באו באותו אוטו ויוצאים יחד.
          </li>
        </ul>
        {players.length < 2 ? (
          <p className="muted">צריך לפחות שני שחקנים.</p>
        ) : (
          <form className="pair-form" onSubmit={addPair}>
            <Segmented
              label="סוג הכלל"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'apart', label: 'לא באותה קבוצה' },
                { value: 'together', label: 'תמיד באותה קבוצה' },
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
              הוספת כלל
            </button>
          </form>
        )}
        {(['apart', 'together'] as const).map((k) =>
          constraints[k].length ? (
            <ul key={k} className="pairs">
              {constraints[k].map(([x, y], i) => (
                <li key={`${x}-${y}`}>
                  <span>
                    {nameOf(x)} ו{nameOf(y)} <span className="muted">· {RULE_LABEL[k]}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label={`הסרת הכלל: ${nameOf(x)} ו${nameOf(y)}`} onClick={() => dispatch({ type: 'removeConstraint', kind: k, index: i })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null,
        )}
      </SettingsFold>

      {sync.configured && (
        <SettingsFold id="account" title="חשבון" value={sync.email ? 'מחוברים' : 'לא מחוברים'}>
          {sync.email ? (
            <>
              <p className="account-who">
                מחוברים בתור <bdi dir="ltr">{sync.email}</bdi>
              </p>
              <p className="hint">
                ״{current.name}״: {current.synced ? STATUS_TEXT[sync.status] : 'בטלפון הזה בלבד. אפשר לסנכרן אותה מתפריט הקבוצות (שם הקבוצה למעלה במסך הראשי).'}
              </p>
              <div className="stack">
                <button type="button" className="btn btn-quiet btn-block" onClick={() => void sync.signOut()}>
                  יציאה מהחשבון
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">לא חובה. צריך רק אם עוד מארגן ינהל איתכם את הקבוצה מהטלפון שלו: השחקנים נשמרים בשרת ומתעדכנים אצל כולם לבד.</p>
              <button type="button" className="btn btn-quiet btn-block" onClick={() => sync.openLogin('account')}>
                התחברות
              </button>
            </>
          )}
        </SettingsFold>
      )}

      <SettingsFold id="backup" title="שיתוף הסגל וגיבוי" value={undefined}>
        <p className="hint">
          {current.synced ? 'הקבוצה מסונכרנת עם החשבון. ' : 'הכול נשמר רק בטלפון הזה. '}
          כדאי לשמור גיבוי, או לשלוח קישור למארגן נוסף. שימו לב: הקישור והקובץ כוללים את הדירוגים. הקובץ שומר גם את היסטוריית הערבים.
        </p>
        <div className="stack">
          <button type="button" className="btn btn-quiet btn-block" disabled={!players.length} onClick={sendLink}>
            <Icon name="link" size={20} /> שליחת קישור למארגן נוסף
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-block"
            disabled={!players.length}
            onClick={() => downloadText(`kochot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(players, constraints, settings, Date.now(), state.history), null, 1), 'application/json')}
          >
            <Icon name="download" size={20} /> הורדת קובץ גיבוי
          </button>
        </div>
        <p className="hint small">שחזור מקובץ: במסך השחקנים, ״ייבוא רשימה״.</p>
      </SettingsFold>

      <SettingsFold id="advanced" title="הנוסחה לחלוקה" value="כמה כל תכונה שוקלת">
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
      </SettingsFold>

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

      <SettingsFold id="data" title="נתונים" value={undefined}>
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
      </SettingsFold>

    </section>
  );
}

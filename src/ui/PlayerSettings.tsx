// Settings in a player group: only this phone's look, who I am, and the account.
import { ACCENTS } from '../state/model';
import { useGroups, useStore } from '../state/store';
import { useSync } from '../sync/SyncProvider';
import { useUi } from './App';
import { Segmented } from './components';
import { HelpLink } from './HelpScreen';
import { useMyName } from './PlayerHome';
import { SettingsFold } from './SettingsFold';

const THEME_NAMES = { light: 'בהיר', dark: 'כהה', auto: 'לפי הטלפון' } as const;

export function PlayerSettings() {
  const { state, dispatch } = useStore();
  const sync = useSync();
  const { current } = useGroups();
  const me = useMyName();
  const { go } = useUi();
  const { settings } = state;
  const set = (patch: Partial<typeof settings>) => dispatch({ type: 'setSettings', settings: { ...settings, ...patch } });

  return (
    <section className="settings" aria-label="הגדרות">
      <HelpLink />
      <SettingsFold id="look" title="מראה" value={THEME_NAMES[settings.theme]}>
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
      </SettingsFold>

      <SettingsFold id="account" startOpen title="חשבון" value={sync.email ? 'מחוברים' : 'לא מחוברים'}>
        {sync.email ? (
          <>
            <p className="account-who">
              מחוברים בתור <bdi dir="ltr">{sync.email}</bdi>
            </p>
            {me ? (
              <p className="hint">
                ״{current.name}״: אני {me} · טעות? בקשו מהמארגן לשחרר
              </p>
            ) : (
              <button type="button" className="btn btn-quiet btn-block" onClick={() => go('claim')}>
                מי אתה?
              </button>
            )}
            <button type="button" className="btn btn-quiet btn-block" onClick={() => go('me')}>
              לדף שלי
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-quiet btn-block" onClick={() => sync.openLogin('account')}>
            התחברות
          </button>
        )}
      </SettingsFold>
    </section>
  );
}

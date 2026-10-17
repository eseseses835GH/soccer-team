import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Toast } from './components';
import { GameScreen } from './GameScreen';
import { PlayersScreen } from './PlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { TeamsScreen } from './TeamsScreen';
import { Icon } from './icons';

export type Tab = 'players' | 'game' | 'teams' | 'settings';
const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'players', label: 'שחקנים', icon: 'users' },
  { id: 'game', label: 'המשחק', icon: 'check' },
  { id: 'teams', label: 'קבוצות', icon: 'shirt' },
  { id: 'settings', label: 'הגדרות', icon: 'sliders' },
];

const isTab = (s: string): s is Tab => TABS.some((t) => t.id === s);

interface Ui {
  go: (t: Tab) => void;
  notify: (msg: string) => void;
}
const UiCtx = createContext<Ui>({ go: () => {}, notify: () => {} });
export const useUi = () => useContext(UiCtx);

function initialTab(hasPlayers: boolean, hasResult: boolean): Tab {
  const h = location.hash.slice(1);
  if (isTab(h)) return h;
  if (hasResult) return 'teams';
  return hasPlayers ? 'game' : 'players';
}

export function App() {
  const { state } = useStore();
  const [tab, setTab] = useState<Tab>(() => initialTab(state.players.length > 0, !!state.result));
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>(undefined);

  const go = useCallback((t: Tab) => {
    setTab(t);
    if (location.hash.slice(1) !== t) history.pushState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => {
      const h = location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const present = state.presentIds.length;

  return (
    <UiCtx.Provider value={{ go, notify }}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-ball" aria-hidden="true">
            ⚽
          </span>
          <h1>כוחות</h1>
        </div>
        <p className="tagline">חלוקה הוגנת, בלי קפטנים</p>
      </header>
      <main className="screen">
        {tab === 'players' && <PlayersScreen />}
        {tab === 'game' && <GameScreen />}
        {tab === 'teams' && <TeamsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabbar" aria-label="ניווט ראשי">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go(t.id)}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'game' && present > 0 && <span className="badge">{present}</span>}
          </button>
        ))}
      </nav>
      <Toast message={toast} />
    </UiCtx.Provider>
  );
}

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IMPORT_HASH, decodeBackup, mergePlayers, type Backup } from '../state/io';
import { useStore } from '../state/store';
import { Sheet, Toast } from './components';
import { HomeScreen } from './HomeScreen';
import { Icon } from './icons';
import { MatchScreen } from './MatchScreen';
import { PlayersScreen } from './PlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { TeamsScreen } from './TeamsScreen';

export type Route = 'home' | 'teams' | 'match' | 'players' | 'settings';
const ROUTES: Route[] = ['home', 'teams', 'match', 'players', 'settings'];
const TITLES: Record<Route, string> = { home: '', teams: 'הקבוצות', match: 'משחק', players: 'השחקנים', settings: 'הגדרות' };
/** Where "back" goes from each screen. */
const PARENT: Record<Route, Route> = { home: 'home', teams: 'home', match: 'teams', players: 'home', settings: 'home' };

const isRoute = (s: string): s is Route => (ROUTES as string[]).includes(s);

interface Ui {
  go: (r: Route) => void;
  notify: (msg: string) => void;
}
const UiCtx = createContext<Ui>({ go: () => {}, notify: () => {} });
export const useUi = () => useContext(UiCtx);

function initialRoute(hasResult: boolean, hasMatch: boolean): Route {
  const h = location.hash.slice(1);
  if (isRoute(h)) return h;
  if (hasMatch) return 'match';
  return hasResult ? 'teams' : 'home';
}

export function App() {
  const { state, dispatch } = useStore();
  const [route, setRoute] = useState<Route>(() => initialRoute(!!state.result, !!state.match));
  const [toast, setToast] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const timer = useRef<number>(undefined);

  const go = useCallback((r: Route) => {
    setRoute(r);
    if (location.hash.slice(1) !== r) history.pushState(null, '', `#${r}`);
    window.scrollTo({ top: 0 });
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const { theme, accent } = state.settings;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    if (accent === 'green') delete root.dataset.accent;
    else root.dataset.accent = accent;
    // The phone's status bar colour follows the chosen theme too.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      const dark = theme === 'auto' ? m.media.includes('dark') : theme === 'dark';
      m.content = dark ? '#0f100e' : '#f5f4ef';
    });
  }, [theme, accent]);

  useEffect(() => {
    const onPop = () => {
      const h = location.hash.slice(1);
      setRoute(isRoute(h) ? h : 'home');
    };
    window.addEventListener('popstate', onPop);
    // A backup link was opened: offer to import it.
    if (location.hash.startsWith(IMPORT_HASH)) {
      decodeBackup(location.hash.slice(IMPORT_HASH.length)).then((b) => {
        history.replaceState(null, '', '#home');
        setRoute('home');
        if (b) setIncoming(b);
        else notify('הקישור לא תקין');
      });
    }
    return () => window.removeEventListener('popstate', onPop);
  }, [notify]);

  // Screens that need data fall back home.
  const safeRoute: Route = (route === 'teams' && !state.result) || (route === 'match' && !state.match) ? (state.result ? 'teams' : 'home') : route;

  const doImport = () => {
    if (!incoming) return;
    const m = mergePlayers(state.players, incoming.players);
    const mapPair = ([a, b]: [string, string]) => [m.idMap.get(a) ?? a, m.idMap.get(b) ?? b] as [string, string];
    const ids = new Set(m.players.map((p) => p.id));
    const merged = (list: [string, string][], extra: [string, string][]) =>
      [...list, ...extra.map(mapPair)].filter(([a, b], i, all) => ids.has(a) && ids.has(b) && all.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)) === i);
    dispatch({
      type: 'importPlayers',
      players: m.players,
      constraints: {
        together: merged(state.constraints.together, incoming.constraints.together),
        apart: merged(state.constraints.apart, incoming.constraints.apart),
      },
    });
    setIncoming(null);
    notify(`נוספו ${m.added}, עודכנו ${m.updated}`);
  };

  return (
    <UiCtx.Provider value={{ go, notify }}>
      <header className={`topbar ${safeRoute === 'home' ? 'is-home' : ''}`}>
        {safeRoute === 'home' ? (
          <>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                ⚽
              </span>
              <span>כוחות</span>
            </div>
            <nav className="top-actions" aria-label="תפריט">
              <button type="button" className="icon-btn" aria-label="השחקנים" onClick={() => go('players')}>
                <Icon name="users" />
              </button>
              <button type="button" className="icon-btn" aria-label="הגדרות" onClick={() => go('settings')}>
                <Icon name="gear" />
              </button>
            </nav>
          </>
        ) : (
          <>
            <button type="button" className="back-btn" onClick={() => go(PARENT[safeRoute])}>
              <Icon name="back" />
              <span>{PARENT[safeRoute] === 'teams' ? 'לקבוצות' : 'חזרה'}</span>
            </button>
            <h1 className="topbar-title">{TITLES[safeRoute]}</h1>
            <span className="topbar-spacer" />
          </>
        )}
      </header>
      <main className={`screen screen-${safeRoute}`}>
        {safeRoute === 'home' && <HomeScreen />}
        {safeRoute === 'teams' && <TeamsScreen />}
        {safeRoute === 'match' && <MatchScreen />}
        {safeRoute === 'players' && <PlayersScreen />}
        {safeRoute === 'settings' && <SettingsScreen />}
      </main>
      {incoming && (
        <Sheet title="ייבוא סגל" onClose={() => setIncoming(null)}>
          <p className="lead">
            בקישור יש {incoming.players.length} שחקנים עם הדירוגים שלהם. שחקנים עם אותו שם יעודכנו, והשאר יתווספו.
          </p>
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" onClick={doImport}>
              ייבוא
            </button>
            <button type="button" className="btn btn-quiet btn-block" onClick={() => setIncoming(null)}>
              ביטול
            </button>
          </div>
        </Sheet>
      )}
      <Toast message={toast} />
    </UiCtx.Provider>
  );
}

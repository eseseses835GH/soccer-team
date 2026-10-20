import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IMPORT_HASH, decodeBackup, mergePlayers, type Backup } from '../state/io';
import { useGroups, useStore } from '../state/store';
import { JOIN_HASH, STATUS_TEXT, useSync, type SyncStatus } from '../sync/SyncProvider';
import { AccountSheet } from './AccountSheet';
import { Sheet, Toast } from './components';
import { EveningScreen, HistoryScreen } from './HistoryScreen';
import { GroupsSheet } from './GroupsSheet';
import { HelpScreen } from './HelpScreen';
import { HomeScreen } from './HomeScreen';
import { useRecordUse } from './InstallPrompt';
import { Icon } from './icons';
import { MatchScreen } from './MatchScreen';
import { PlayersScreen } from './PlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { TeamsScreen } from './TeamsScreen';

export type Route = 'home' | 'teams' | 'match' | 'players' | 'settings' | 'history' | 'evening' | 'help';
const ROUTES: Route[] = ['home', 'teams', 'match', 'players', 'settings', 'history', 'evening', 'help'];
const TITLES: Record<Route, string> = {
  home: '',
  teams: 'הקבוצות',
  match: 'משחק',
  players: 'השחקנים',
  settings: 'הגדרות',
  history: 'ערבים קודמים',
  evening: 'סיכום הערב',
  help: 'שאלות ותשובות',
};
/** Where "back" goes from each screen. */
const PARENT: Record<Route, Route> = { home: 'home', teams: 'home', match: 'teams', players: 'home', settings: 'home', history: 'home', evening: 'history', help: 'home' };
/** Help can be opened from several screens; "back" returns to the one it came from. */
const HELP_FROM: Route[] = ['home', 'teams', 'match', 'players', 'settings'];

const isRoute = (s: string): s is Route => (ROUTES as string[]).includes(s);

/** `#evening/<id>`: a route plus an optional parameter. */
function parseHash(): { route: Route | null; param: string } {
  const [name, ...rest] = location.hash.slice(1).split('/');
  return { route: isRoute(name) ? name : null, param: decodeURIComponent(rest.join('/')) };
}

interface Ui {
  go: (r: Route, param?: string) => void;
  notify: (msg: string) => void;
}
const UiCtx = createContext<Ui>({ go: () => {}, notify: () => {} });
export const useUi = () => useContext(UiCtx);

function initialRoute(hasResult: boolean, hasMatch: boolean): Route {
  const { route } = parseHash();
  if (route) return route;
  if (hasMatch) return 'match';
  return hasResult ? 'teams' : 'home';
}

export function App() {
  const { state, dispatch } = useStore();
  const groups = useGroups();
  const sync = useSync();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [route, setRoute] = useState<Route>(() => initialRoute(!!state.result, !!state.match));
  const [param, setParam] = useState(() => parseHash().param);
  const [toast, setToast] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const timer = useRef<number>(undefined);
  useRecordUse(state.players.length > 0);

  const routeNow = useRef(route);
  routeNow.current = route;
  const helpFrom = useRef<Route>('home');
  const go = useCallback((r: Route, p = '') => {
    if (r === 'help' && HELP_FROM.includes(routeNow.current)) helpFrom.current = routeNow.current;
    setRoute(r);
    setParam(p);
    const hash = p ? `${r}/${encodeURIComponent(p)}` : r;
    if (location.hash.slice(1) !== hash) history.pushState(null, '', `#${hash}`);
    window.scrollTo({ top: 0 });
  }, []);

  const startJoin = useRef(sync.startJoin);
  startJoin.current = sync.startJoin;
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
      const h = parseHash();
      setRoute(h.route ?? 'home');
      setParam(h.param);
    };
    window.addEventListener('popstate', onPop);
    // An organizer invite was opened: join (after logging in if needed).
    if (location.hash.startsWith(JOIN_HASH)) {
      const token = decodeURIComponent(location.hash.slice(JOIN_HASH.length));
      history.replaceState(null, '', `${location.pathname}#home`);
      setRoute('home');
      if (token) startJoin.current(token);
    }
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

  // Messages from sync (joined a group, logged out, errors…).
  useEffect(() => {
    if (sync.message) notify(sync.message.text);
  }, [sync.message, notify]);

  // Say hello when a login finishes.
  const prevEmail = useRef(sync.email);
  useEffect(() => {
    if (prevEmail.current === false && sync.email) notify('התחברתם');
    prevEmail.current = sync.email;
  }, [sync.email, notify]);

  // Screens that need data fall back home.
  const evening = route === 'evening' ? state.history.find((e) => e.id === param) : undefined;
  const safeRoute: Route =
    (route === 'teams' && !state.result) || (route === 'match' && !state.match)
      ? state.result
        ? 'teams'
        : 'home'
      : route === 'evening' && !evening
        ? 'history'
        : route;

  const backTo = safeRoute === 'help' ? helpFrom.current : PARENT[safeRoute];

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
            <button type="button" className="brand group-btn" aria-label={`קבוצה: ${groups.current.name}. החלפת קבוצה`} onClick={() => setGroupsOpen(true)}>
              <span className="brand-mark" aria-hidden="true">
                ⚽
              </span>
              <span className="brand-text">
                <span className="brand-name">כוחות</span>
                <span className="group-name">
                  <span className="group-name-text">{groups.current.name}</span>
                  {groups.current.synced && <SyncDot status={sync.status} />}
                  <span className="chev" aria-hidden="true">
                    ▾
                  </span>
                </span>
              </span>
            </button>
            <nav className="top-actions" aria-label="תפריט">
              {state.history.length > 0 && (
                <button type="button" className="icon-btn" aria-label="ערבים קודמים" onClick={() => go('history')}>
                  <Icon name="history" />
                </button>
              )}
              <button type="button" className="icon-btn" aria-label="השחקנים" onClick={() => go('players')}>
                <Icon name="users" />
              </button>
              <button type="button" className="icon-btn" aria-label="הגדרות" onClick={() => go('settings')}>
                <Icon name="gear" />
              </button>
              <button type="button" className="icon-btn help-btn" aria-label="שאלות ותשובות" onClick={() => go('help')}>
                <Icon name="help" size={20} />
              </button>
            </nav>
          </>
        ) : (
          <>
            <button type="button" className="back-btn" onClick={() => go(backTo)}>
              <Icon name="back" />
              <span>{backTo === 'teams' ? 'לקבוצות' : 'חזרה'}</span>
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
        {safeRoute === 'history' && <HistoryScreen />}
        {safeRoute === 'evening' && evening && <EveningScreen record={evening} />}
        {safeRoute === 'help' && <HelpScreen focus={param} />}
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
      {groupsOpen && <GroupsSheet onClose={() => setGroupsOpen(false)} />}
      {sync.loginReason && <AccountSheet reason={sync.loginReason} onClose={sync.closeLogin} />}
      <Toast message={toast} />
    </UiCtx.Provider>
  );
}

const DOT_TONE: Record<SyncStatus, string> = {
  local: 'off',
  synced: 'ok',
  syncing: 'busy',
  pending: 'busy',
  offline: 'warn',
  signedOut: 'warn',
  error: 'bad',
  gone: 'bad',
};

/** A small dot next to the group name: synced / syncing / offline / error. */
function SyncDot({ status }: { status: SyncStatus }) {
  return <span className={`sync-dot tone-${DOT_TONE[status]}`} role="img" aria-label={STATUS_TEXT[status]} title={STATUS_TEXT[status]} />;
}

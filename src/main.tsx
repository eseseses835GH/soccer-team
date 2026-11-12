import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import { SyncProvider } from './sync/SyncProvider';
import { PlayerGroupProvider } from './sync/PlayerGroupProvider';
import { RunnerProvider } from './sync/RunnerProvider';
import { App } from './ui/App';
import { Crash } from './ui/Crash';
import { captureAuthArrival } from './sync/authUrl';
import './styles.css';

// A login coming back through the address (email link, Google): read it and clean the URL first.
captureAuthArrival();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <StoreProvider>
        <SyncProvider>
          <PlayerGroupProvider>
            <RunnerProvider>
              <App />
            </RunnerProvider>
          </PlayerGroupProvider>
        </SyncProvider>
      </StoreProvider>
    </Crash>
  </StrictMode>,
);

// Offline support at the pitch + "add to home screen" (also keeps iOS from evicting local data).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // A new version took over while this page runs old code (iOS keeps an installed app in memory):
  // offer a reload instead of silently showing the old screens. Never reload by itself (a match may run).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.dispatchEvent(new Event('kochot:update-ready'));
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Look for a new version whenever the app comes back to the screen.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

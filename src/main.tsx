import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import { SyncProvider } from './sync/SyncProvider';
import { PlayerGroupProvider } from './sync/PlayerGroupProvider';
import { RunnerProvider } from './sync/RunnerProvider';
import { App } from './ui/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <SyncProvider>
        <PlayerGroupProvider>
          <RunnerProvider>
            <App />
          </RunnerProvider>
        </PlayerGroupProvider>
      </SyncProvider>
    </StoreProvider>
  </StrictMode>,
);

// Offline support at the pitch + "add to home screen" (also keeps iOS from evicting local data).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

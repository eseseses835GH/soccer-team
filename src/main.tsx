import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import { App } from './ui/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

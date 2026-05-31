import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@ritmiq/ui';
import { installZoomBlocker } from '@ritmiq/ui/lib/block-zoom.js';
import { setupPwaUpdates } from './pwa-update.js';
import '@ritmiq/ui/styles/global.css';

installZoomBlocker();

// Registra el SW y el flujo de actualización in-app (toast "Actualizar" +
// auto-check cada 24h). Actualizar NO borra las descargas (IndexedDB).
setupPwaUpdates();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

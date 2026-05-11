import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@ritmiq/ui';
import { installZoomBlocker } from '@ritmiq/ui/lib/block-zoom.js';
import '@ritmiq/ui/styles/global.css';

installZoomBlocker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

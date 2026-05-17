import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './env.js';
// Cargar .env.production / .env.development ANTES que cualquier otro módulo
// que dependa de process.env (supabase-server, etc.).
loadEnv();
import { startLanServer } from './lan-server.js';
import { initDb } from './db.js';
import { registerIpc } from './ipc.js';
import { cloudflared, getStoredToken } from './cloudflared.js';
import { getOrCreateAccessToken } from './access-token.js';
import { getOrCreateSigningSecret } from './signing-secret.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** @type {BrowserWindow|null} */
let mainWindow = null;

async function createWindow() {
  // Icono de ventana — en Linux y Windows aplica al titlebar/taskbar;
  // en macOS lo define el .icns generado por electron-builder.
  const iconPath = isDev
    ? join(__dirname, '../build-resources/icon.png')
    : join(process.resourcesPath, 'build-resources/icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: '#0a0a0c',
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
    },
  });

  // Bloquear zoom en desktop (atajos teclado y rueda Ctrl).
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if ((input.control || input.meta) && ['=', '-', '+', '0'].includes(input.key)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/dist/index.html'));
  }
}

app.whenReady().then(async () => {
  const db = initDb();

  // Token de acceso (Bearer) para que clientes externos (PWA via tunnel)
  // se autentiquen contra el LAN server. Se genera al primer arranque.
  const accessToken = getOrCreateAccessToken();

  // Secret HMAC para validar firmas de la Edge `sign-stream`. Local al
  // desktop, NO embebido en el AppImage. Si el secret cambia, todas las
  // firmas vigentes invalidan (TTL 5 min) y la Edge debe actualizarse.
  // Se inyecta a process.env para que lan-server (que lee la var) lo vea.
  process.env.RITMIQ_STREAM_SIGNING_SECRET = getOrCreateSigningSecret();

  // El LAN server NO debe ser bloqueante. Si falla, seguimos cargando la app.
  let lan = { port: null, stop: () => {} };
  try {
    lan = await startLanServer({ port: 3939, db, accessToken });
  } catch (err) {
    console.error('[main] LAN server no arrancó:', err.message);
  }

  registerIpc({ db, lan, accessToken });

  // Notificacion nativa cuando llega una pair request — el owner ve
  // un toast aunque la app no este en foco.
  if (typeof lan?.onPairRequest === 'function') {
    lan.onPairRequest(({ displayName, pin }) => {
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'Ritmiq · nuevo dispositivo',
            body: `${displayName} quiere conectarse. PIN: ${pin}`,
          });
          n.on('click', () => {
            const w = BrowserWindow.getAllWindows()[0];
            if (w) { w.show(); w.focus(); }
          });
          n.show();
        }
      } catch (err) { console.warn('[main] notification failed', err.message); }
    });
  }

  // No autoarrancamos el tunnel sin elección explícita del usuario.
  // Si hay token guardado, asumimos que el user quiere modo Named.
  if (getStoredToken()) {
    cloudflared.start({ mode: 'named' }).catch((err) => {
      console.error('[main] tunnel start falló:', err.message);
    });
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async () => {
  try { await cloudflared.stop(); } catch {}
});

// Capturar excepciones no manejadas para evitar el diálogo brutal de Electron.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

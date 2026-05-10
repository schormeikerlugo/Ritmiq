import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startLanServer } from './lan-server.js';
import { initDb } from './db.js';
import { registerIpc } from './ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** @type {BrowserWindow|null} */
let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: '#0a0a0c',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
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

  // El LAN server NO debe ser bloqueante. Si falla (puerto ocupado tras
  // todos los intentos, permisos, etc.), seguimos cargando la app — sólo
  // perdemos la capacidad de servir audio a otros dispositivos en LAN.
  let lan = { port: null, stop: () => {} };
  try {
    lan = await startLanServer({ port: 3939, db });
  } catch (err) {
    console.error('[main] LAN server no arrancó:', err.message);
    // Mostrar después en UI vía un evento, por ahora solo log.
  }

  registerIpc({ db, lan });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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

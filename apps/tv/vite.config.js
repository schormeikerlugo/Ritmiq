import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Build de la interfaz para la app de Google TV (Capacitor). Igual que la PWA
// pero sin service worker: Capacitor sirve los archivos desde el APK.
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

export default defineConfig({
  envDir: resolve(process.cwd(), '../..'),
  define: {
    // Servidor 24/7 por la red local (ver lan-client.js SERVER_LAN_URL).
    'import.meta.env.VITE_SERVER_LAN_URL': JSON.stringify(
      process.env.RITMIQ_TV_SERVER_LAN_URL ?? 'http://192.168.68.117:3939',
    ),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});

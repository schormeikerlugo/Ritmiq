import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(process.cwd(), 'renderer'),
  base: './',
  envDir: resolve(process.cwd(), '../..'),
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: resolve(process.cwd(), 'renderer/dist'),
    emptyOutDir: true,
  },
});

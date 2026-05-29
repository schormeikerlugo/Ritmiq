/**
 * Playwright config para Ritmiq PWA \u2014 smoke tests E2E (Fase 7.5).
 *
 * Scope V1: validar que la app bootea sin errores fatales y llega al
 * AuthScreen visible. Tests de flujos completos (signup, play, share)
 * requieren un usuario seed estable y mocks del backend Supabase \u2014
 * se documentan en e2e/README.md para implementacion futura.
 *
 * Para correr:
 *   cd apps/pwa
 *   pnpm exec playwright install chromium    # primera vez
 *   pnpm exec playwright test
 *
 * El test arranca el dev server via `vite preview` (build estatico),
 * NO via `vite` dev (mas lento y con HMR injectado).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173; // default vite preview port
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Lenient en local; en CI puede ser mas estricto.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Headless por default. Para debugging: HEADED=1 pnpm exec playwright test
    headless: !process.env.HEADED,
    // Screenshots solo en fallo para no llenar el disco.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Auto-arranca el preview server antes de los tests.
  webServer: {
    command: 'pnpm run preview --port 4173',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

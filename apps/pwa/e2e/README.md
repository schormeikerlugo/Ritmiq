# Playwright E2E tests

> Fase 7.5 — V1 cubre smoke tests del boot. Flujos completos están documentados como follow-up.

## Setup

```bash
cd apps/pwa
pnpm exec playwright install chromium  # primera vez
```

## Correr

```bash
# Headless (default):
pnpm exec playwright test

# Con UI visible (debug):
HEADED=1 pnpm exec playwright test

# Single test:
pnpm exec playwright test smoke.spec.js
```

El config arranca automáticamente `pnpm run preview` (build estático del
`dist/`) antes de los tests. Requiere haber corrido `pnpm run build` antes.

## Tests actuales

### `smoke.spec.js`
- **`app bootea, splash se reemplaza, AuthScreen visible`**
  - React monta < 5s.
  - Sin sesión persistida → AuthScreen visible.
  - Cero errores fatales en consola (filtra ruido conocido).
  - Cero 4xx/5xx en assets críticos.
- **`chunk lazy de SettingsView NO se descarga en el boot`**
  - Valida code-splitting de Fase 7.1+7.2.
  - SettingsView chunk no presente en network del boot.
  - Bundle principal sí cargado.

## Tests pendientes (V2)

Requieren un usuario seed en Supabase + estrategia de auth mockeada.

### Flujo Auth
- `auth/signup-flow.spec.js`:
  - Click "Crear cuenta" → completar email/password → submit.
  - Validar mensaje de confirmación email.
  - Cleanup: borrar el user via service_role tras el test.

- `auth/signin-flow.spec.js`:
  - Login con seed user.
  - Validar que llega a Home con `<HomeStats>` visible.
  - Logout → vuelve a AuthScreen.

### Flujo Play
- `play/search-and-play.spec.js`:
  - Login como seed user.
  - Search "Bohemian Rhapsody".
  - Click primer resultado.
  - Validar `<audio>` reproduciendo (`audio.paused === false` después de 1s).
  - Pause → validar `paused === true`.

### Flujo Share
- `share/copy-link.spec.js`:
  - Login + play un track.
  - Click "Compartir link".
  - Validar clipboard contiene URL `/share/track/...`.

- `share/landing.spec.js`:
  - Visitar `/share/track/<ytId>?meta=<b64>` sin sesión.
  - Validar SharedView visible con metadata correcta.

## Estrategia de auth seed

Opción A (recomendada): variable env `RITMIQ_E2E_USER_EMAIL` +
`RITMIQ_E2E_USER_PASSWORD` para un user dedicado en el proyecto Supabase.
El usuario se crea manualmente o vía migration.

Opción B (CI puro): mock del cliente `@supabase/supabase-js` con MSW para
no requerir DB live. Más rápido pero requiere mantener el mock al día.

## Cuándo correr

- **Localmente antes de un PR**: smoke + cualquier suite afectada por el cambio.
- **CI (futuro)**: GitHub Actions con `on: pull_request`. Cache de `~/.cache/ms-playwright`.

## Cuándo NO correr

- Cambios solo de docs.
- Cambios solo de migration SQL.
- Backend (Edge Functions) — tienen sus propios tests Deno.

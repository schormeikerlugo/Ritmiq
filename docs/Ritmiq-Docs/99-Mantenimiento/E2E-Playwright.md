---
tipo: convencion
capa: meta
plataforma: pwa
estado: estable
ultima-revision: 2026-05-28
archivo: apps/pwa/playwright.config.js
tags: [test, e2e, playwright, smoke, qa]
---

# E2E con Playwright

> Suite skeleton de E2E para la PWA, instalada en Fase 7.5. V1 cubre smoke (boot + code-splitting). V2 documentada para futuro. Ver [[Decisiones-Tecnicas-ADR|ADR-018]].

## Ubicación
`apps/pwa/playwright.config.js` + `apps/pwa/e2e/*.spec.js`

## Setup primera vez

```bash
cd apps/pwa
pnpm exec playwright install chromium    # ~300 MB
```

## Correr

```bash
# Build estático (requisito):
pnpm --filter @ritmiq/pwa build

# Headless (default):
pnpm --filter @ritmiq/pwa run test:e2e

# Con UI visible (debug):
pnpm --filter @ritmiq/pwa run test:e2e:headed
```

El config arranca automáticamente `vite preview --port 4173` con el `dist/` ya construido.

## Tests V1 (actuales)

### `smoke.spec.js > app bootea, splash se reemplaza, AuthScreen visible`

| Paso | Aserción |
|---|---|
| `page.goto('/')` | React monta `#root` en < 5s |
| Sin sesión persistida | Detecta texto "Iniciar sesion" / "Continuar" / "Registr..." |
| Consola | Sin errores fatales (filtra ruido conocido: `ERR_CONNECTION_CLOSED` de `presence` cleanup) |
| HTTP | Sin 4xx/5xx en assets críticos (`/assets/*.js`, `*.css`) |
| Service Worker | Warning si no registrado (no fail; preview no siempre registra) |

### `smoke.spec.js > chunk lazy de SettingsView NO se descarga en el boot`

Valida el code-splitting de Fases 7.1 + 7.2:

| Paso | Aserción |
|---|---|
| Capturar network al boot | `SettingsView-*.js` **NO** debe aparecer en network |
| Bundle principal | `/assets/index-<hash>.js` **SÍ** debe haber sido cargado |

## Tests V2 (pendientes)

Requieren seed user en Supabase + estrategia de auth mock.

### Flujo Auth

- `auth/signup-flow.spec.js` — completar email/password, validar mensaje, cleanup del user vía service_role.
- `auth/signin-flow.spec.js` — login + validar Home con `<HomeStats>` visible + logout.

### Flujo Play

- `play/search-and-play.spec.js` — login → search → click track → validar `<audio>` reproduciendo + pause.

### Flujo Share

- `share/copy-link.spec.js` — login + play → click "Compartir link" → validar clipboard.
- `share/landing.spec.js` — visitar `/share/track/<ytId>?meta=<b64>` sin sesión → validar [[SharedView]] con metadata correcta.

## Estrategia de seed user

### Opción A: env vars (recomendada para local)

```bash
export RITMIQ_E2E_USER_EMAIL=e2e@ritmiq.app
export RITMIQ_E2E_USER_PASSWORD=<random>
```

User creado manualmente en Supabase Dashboard. Tests reusan la sesión.

### Opción B: MSW mocks (recomendada para CI puro)

Interceptar `@supabase/supabase-js` con [Mock Service Worker](https://mswjs.io/). Más rápido pero requiere mantener el mock al día.

## Cuándo correr

| Trigger | Suite |
|---|---|
| PR local antes de push | Smoke + suite afectada |
| GitHub Actions (cuando se integre) | Smoke completo + V2 en MR a `main` |

## Cuándo NO correr

- Cambios solo de docs.
- Cambios solo de migration SQL (excepto si la migration rompe el schema visible al cliente).
- Backend (Edge Functions) → tienen sus propios tests Deno (no implementados todavía).

## Artifacts

Tras un fail:
- `apps/pwa/playwright-report/` — HTML report.
- `apps/pwa/test-results/` — screenshots + videos + traces.

Todo está en `.gitignore`.

## Configuración

| Opción | Valor |
|---|---|
| `testDir` | `./e2e` |
| `baseURL` | `http://localhost:4173` (vite preview) |
| `headless` | `true` (default) |
| `retries` (CI) | 2 |
| `retries` (local) | 0 |
| `workers` | 1 |
| `reporter` | `list` (local), `github` (CI) |
| `screenshot` | `only-on-failure` |
| `video` | `retain-on-failure` |
| Browsers | `chromium` only (V1) |

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar el puerto del preview (4173) | Hay que actualizar `BASE_URL` en el config |
| Romper el code-splitting (volver eager el SettingsView) | El 2do smoke test falla |
| Hacer que Home auto-loguee al user (?) | El 1er smoke test no encuentra AuthScreen |

## Changelog

- 2026-05-28 — Creado en Fase 7.5. Commit `a403b2a`. Suite V1 cubre smoke; V2 documentada como follow-up.

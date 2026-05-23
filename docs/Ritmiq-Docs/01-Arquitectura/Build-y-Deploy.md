---
tipo: arquitectura
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: turbo.json
tags: [arquitectura, build, deploy]
---

# Build y Deploy

## Desktop

- Vite empaqueta `apps/desktop/renderer`.
- `apps/desktop/main` y `apps/desktop/preload` se compilan con esbuild.
- Empaquetado final con `electron-builder` (ver `apps/desktop/build-resources/`).
- Salida en `apps/desktop/release/`.
- Recompilación de nativos: `pnpm rebuild better-sqlite3` y luego `pnpm --filter @ritmiq/desktop run rebuild:native`.

## PWA

- Vite build → `apps/pwa/dist/`.
- Deploy a Vercel (ver `vercel.json` y `.vercelignore`).
- `scripts/vercel-postbuild.js` corre tras el build.
- Genera splashscreens con `scripts/generate-splash.sh`.

## Supabase

- Migraciones SQL en `supabase/migrations/` (push con `pnpm supabase:push`).
- Edge Functions: deploy con `scripts/deploy-cloud-functions.sh` y `scripts/deploy-sign-stream.sh`.
- Snippets reutilizables: `supabase/snippets/`.

## Middleware Vercel

`middleware.js` en la raíz aplica reglas a la PWA en producción. Pendiente documentar en F3.

## Pendiente (F1+)

- Detallar `apps/desktop/scripts/` y `build-resources/`.
- Documentar cada script de deploy.

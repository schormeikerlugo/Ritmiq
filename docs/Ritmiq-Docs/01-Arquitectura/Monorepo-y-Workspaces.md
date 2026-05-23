---
tipo: arquitectura
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: pnpm-workspace.yaml
tags: [arquitectura, monorepo]
---

# Monorepo y Workspaces

Gestor: **pnpm 11** con `pnpm-workspace.yaml`. Orquestador: **Turbo 2**.

## Workspaces

```
apps/
  desktop/    → @ritmiq/desktop
  pwa/        → @ritmiq/pwa
packages/
  ui/         → @ritmiq/ui
  core/       → @ritmiq/core
  db/         → @ritmiq/db
  api/        → @ritmiq/api
  yt/         → @ritmiq/yt
```

## Dependencias built (nativas)

Declaradas en `pnpm-workspace.yaml` y en `package.json > pnpm.onlyBuiltDependencies`:

- `better-sqlite3` — SQLite nativo para Desktop.
- `electron` — runtime Desktop.
- `esbuild` — bundler.
- `supabase` — CLI.

## Scripts raíz

| Script | Acción |
|---|---|
| `pnpm dev:desktop` | Vite + Electron en watch |
| `pnpm dev:pwa` | Vite PWA en watch |
| `pnpm build` | `turbo run build` |
| `pnpm lint` | `turbo run lint` |
| `pnpm supabase:start` | Levanta Supabase local (Docker) |
| `pnpm supabase:reset` | Aplica migraciones a DB local |
| `pnpm supabase:push` | Sube migraciones a cloud |
| `pnpm supabase:fn:serve` | Sirve Edge Functions locales |
| `pnpm test:rebuild` | Recompila nativos y corre tests |

## Cómo añadir un package nuevo

1. `mkdir packages/<nombre>/src`
2. Crear `package.json` con `"name": "@ritmiq/<nombre>"` y `"type": "module"`.
3. Crear `jsconfig.json` si querés JSDoc → IntelliSense.
4. Agregar a deps de los apps que lo consumen: `"@ritmiq/<nombre>": "workspace:*"`.
5. `pnpm install` desde la raíz.

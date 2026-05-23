---
tipo: arquitectura
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: .env.development
tags: [arquitectura, env, configuracion]
---

# Variables de Entorno

Archivos en la raíz del repo:

- `.env.development` → Supabase local (`http://127.0.0.1:54321`).
- `.env.local` → overrides del dev (no se commitea).
- `.env.production` → Supabase Cloud (rellenar con proyecto real).

> Las claves específicas se documentarán en F1 cuando inspeccionemos `apps/desktop/main/env.js` y la PWA. Esta nota es un placeholder con la estructura general.

## Convenciones de naming

| Prefijo | Uso |
|---|---|
| `VITE_*` | Expuesta al renderer / PWA (cliente). |
| `SUPABASE_*` | Cliente y servidor de Supabase. |
| `RITMIQ_*` | Específicas del proyecto. Solo main process. |

## Carga

- **Desktop main**: lee desde `process.env` + `dotenv` en `apps/desktop/main/env.js`.
- **Desktop renderer / PWA**: solo ve variables con prefijo `VITE_` (regla de Vite).
- **Edge Functions**: variables se configuran en Supabase Dashboard → Project Settings → Edge Functions.

## Pendiente (a documentar en F1/F7)

- [[env|apps/desktop/main/env.js]]
- Variables de cada [[MOC - Backend Supabase|Edge Function]].

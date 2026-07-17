---
tipo: arquitectura
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: .env.development
tags: [arquitectura, env, configuracion, servidor]
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

## Servidor headless 24/7 (`apps/server/.env`)

Ver plantilla completa en `apps/server/.env.example` y [[apps-server]].

| Variable | Uso |
|---|---|
| `RITMIQ_DATA_DIR` | carpeta writable (SQLite, cookies, tokens, `shared-audio/`). Docker: `/data` |
| `RITMIQ_PORT` | puerto HTTP (default 3939) |
| `RITMIQ_STREAM_SIGNING_SECRET` | secreto HMAC compartido con la Edge `sign-stream` |
| `RITMIQ_ACCEPT_UNSIGNED_STREAMS` | modo compat: acepta `/stream` sin firma |
| `RITMIQ_YTDLP_PATH` / `RITMIQ_YTDLP_JS_RUNTIME` | binario yt-dlp y runtime JS (deno/node) |
| `RITMIQ_YTDLP_COOKIES_FILE` | archivo Netscape de cookies del owner (headless) |
| `RITMIQ_COOKIES_KEY` | clave AES-256-GCM para cifrar cookies por device |
| `RITMIQ_ALLOWED_USERS` | allowlist de `user_id` auto-aprobados al parear |
| `RITMIQ_SUPABASE_JWT_SECRET` | HS256 legacy (si el proyecto no usa ES256/JWKS) |
| `RITMIQ_REQUIRE_AUTH_FOR_PAIR` | exigir JWT válido en `/pair` (default ON) |
| `RITMIQ_YTDLP_CONCURRENCY` | máx. procesos yt-dlp en paralelo (default: cores/2, 3-8) |
| `RITMIQ_TUNNEL_TOKEN` / `RITMIQ_TUNNEL_CUSTOM_URL` / `RITMIQ_TUNNEL_MODE` | Cloudflare Tunnel |
| `RITMIQ_LOGIN_IMAGE` | imagen del contenedor noVNC ([[Login-noVNC]]) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | verificación JWT (JWKS) + publicar endpoint |
| `RITMIQ_OWNER_EMAIL` / `RITMIQ_OWNER_PASSWORD` | credenciales para publicar el endpoint `kind='server'` |

## Ver también

- [[env|apps/desktop/main/env.js]]
- [[apps-server]], [[Autenticacion-y-JWT]], [[Cache-y-Rendimiento]].
- Variables de cada [[MOC - Backend Supabase|Edge Function]].

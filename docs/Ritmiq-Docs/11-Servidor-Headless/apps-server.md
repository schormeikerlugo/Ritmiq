---
tipo: aplicacion
capa: servidor
plataforma: servidor
estado: estable
ultima-revision: 2026-07-17
archivo: apps/server/src/index.js
tags: [servidor, headless, docker, systemd, cli]
---

# `apps/server` — Bootstrap headless

> Servicio Node 24/7 que arranca el LAN server ([[server-core]]) fuera de
> Electron. Solo contiene el **bootstrap del entorno headless** + una CLI de
> administración; toda la lógica vive en `@ritmiq/server-core`.

## Ubicación
`apps/server/`

## Estructura

| Archivo | Qué |
|---|---|
| `src/index.js` | bootstrap: `setHost` → `initDb` → `startLanServer` → túnel → publicación de endpoint |
| `src/cli.js` | CLI `ritmiq-admin` (pending, approve, reject, devices, revoke, token) |
| `src/config.js` | `resolveDataDir()` (`RITMIQ_DATA_DIR`), `resolvePort()` (3939) |
| `src/env.js` | carga de `.env` |
| `src/endpoint-registry.js` | publica el endpoint `kind='server'` en Supabase (`tunnel_endpoints`) |
| `src/import-shared-cache.js` | re-indexa `shared-audio/` en la tabla `shared_audio` (migración de caché) |
| `Dockerfile` | imagen Node 22 + yt-dlp + deno + docker.io (para login noVNC) |
| `docker-compose.yml` | servicio + volumen `ritmiq-data` + montaje de `/var/run/docker.sock` |
| `deploy/ritmiq-server.service` | unit de systemd (alternativa a Docker) |
| `.env.example` | plantilla de variables |
| `README.md` | guía de despliegue completa |

## Bootstrap (`index.js`)

1. `setHost({ dataDir, safeStorage: null, ... })` — host headless.
2. `initDb()` + `getOrCreateAccessToken()` (token del dueño, se imprime al arrancar).
3. `startLanServer({ port, db, accessToken })` — lee `VITE_SUPABASE_URL` /
   `RITMIQ_SUPABASE_JWT_SECRET` para la verificación JWT.
4. Si hay `RITMIQ_TUNNEL_TOKEN` o `RITMIQ_TUNNEL_MODE`: arranca `CloudflaredManager`
   y publica el endpoint `kind='server'` (para que la PWA lo descubra).
5. `onPairRequest` → log en consola con el PIN (el dueño aprueba con CLI/panel/desktop).

## Despliegue (Docker)

```bash
# Construir imágenes
docker build -f apps/server/Dockerfile -t ritmiq-server:latest .
docker build -f apps/login-agent/Dockerfile -t ritmiq-login:latest .   # login noVNC

# Configurar apps/server/.env (chmod 600) y arrancar
docker compose -f apps/server/docker-compose.yml up -d --build
```

- Volumen `ritmiq-data` → `/data` (SQLite, cookies, tokens, `shared-audio/`).
- `RITMIQ_DATA_DIR=/data`.
- El contenedor healthy responde `/health`.

## CLI `ritmiq-admin`

```
ritmiq-admin token            # imprime el access-token del dueño
ritmiq-admin pending          # solicitudes de pareo pendientes (con PIN)
ritmiq-admin approve <id>     # aprobar un dispositivo
ritmiq-admin reject <id>      # rechazar
ritmiq-admin devices          # listar dispositivos
ritmiq-admin revoke <id>      # revocar
```

## Variables de entorno clave

Ver [[Variables-de-Entorno]] para el listado completo. Las específicas del servidor:

- `RITMIQ_DATA_DIR`, `RITMIQ_PORT`
- `RITMIQ_STREAM_SIGNING_SECRET`, `RITMIQ_ACCEPT_UNSIGNED_STREAMS`
- `RITMIQ_YTDLP_PATH`, `RITMIQ_YTDLP_JS_RUNTIME`, `RITMIQ_YTDLP_COOKIES_FILE`
- `RITMIQ_COOKIES_KEY` (cifrado de cookies por device)
- `RITMIQ_ALLOWED_USERS`, `RITMIQ_SUPABASE_JWT_SECRET`, `RITMIQ_REQUIRE_AUTH_FOR_PAIR`
- `RITMIQ_YTDLP_CONCURRENCY` (prewarms en paralelo)
- `RITMIQ_TUNNEL_TOKEN`, `RITMIQ_TUNNEL_CUSTOM_URL`
- `RITMIQ_LOGIN_IMAGE` (imagen del contenedor noVNC)

## Ver también

- [[server-core]], [[lan-server]], [[Administracion-Dispositivos]], [[Cache-y-Rendimiento]].

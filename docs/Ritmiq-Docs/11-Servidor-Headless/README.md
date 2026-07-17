---
tipo: indice
capa: servidor
plataforma: servidor
estado: estable
ultima-revision: 2026-07-17
tags: [servidor, headless, docker, indice]
---

# 11 — Servidor Headless 24/7

> Índice de la capa **servidor casero 24/7**: el LAN server de Ritmiq corriendo
> como servicio Node **sin Electron**, en un servidor doméstico, para no depender
> de tener la app desktop abierta. Comparte toda la lógica con el desktop vía
> [[server-core]].

## Contexto

Antes, el "algoritmo de búsqueda/descarga de YouTube" vivía solo en el desktop
(Electron levantaba el LAN server). Se migró a un **servidor casero 24/7** con:

- Selección automática de host (desktop ↔ servidor) desde el cliente.
- Cuentas propias de YouTube por usuario (cookies cifradas).
- Administración de dispositivos multi-nivel (dueño + sub-admin por cuenta).
- Identidad verificada con JWT de Supabase.
- Optimizaciones de rendimiento (caché de búsqueda, prewarm, concurrencia).

Servidor de referencia: `192.168.68.117`, túnel `ritmiq.org` (Named Tunnel de
Cloudflare movido del desktop al servidor). Despliegue en Docker + Compose.

## Notas

- [[server-core]] — paquete `@ritmiq/server-core` host-aware (lógica compartida).
- [[apps-server]] — bootstrap headless (`apps/server`): index, CLI, Docker, systemd.
- [[Autenticacion-y-JWT]] — verificación de JWT Supabase (ES256/JWKS) + niveles de auth.
- [[Administracion-Dispositivos]] — pareo, allowlist, panel `/admin`, admin por cuenta, cookies vía desktop.
- [[Login-noVNC]] — vinculación de cuenta YouTube por navegador remoto (`apps/login-agent`).
- [[Cache-y-Rendimiento]] — caché de archivos/URLs/búsqueda, prewarm, concurrencia, migración de caché.
- [[Multi-Endpoint-y-Seleccion-Host]] — publicación de endpoints y selección servidor/desktop.

## Fases del proyecto (histórico)

| Fase | Qué | Estado |
|---|---|---|
| **1** | Servidor headless: `server-core` host-aware + `apps/server` | ✅ |
| **2** | Multi-endpoint + selector de host (auto/prefer-server/fastest) | ✅ |
| **3a** | Cifrado de cookies (AES-256-GCM) + subida `cookies.txt` | ✅ |
| **3b** | Login por navegador remoto (noVNC + Playwright) | ✅ |
| **3c** | Allowlist de cuentas + panel web `/admin` | ✅ |
| **4** | Identidad JWT verificada + admin por cuenta + cookies vía desktop | ✅ |
| **A-D** | Optimización de tiempo de respuesta (caché/prewarm/concurrencia) | ✅ |

## Endpoints HTTP (resumen)

```
GET  /health                          → { ok, service, version }
GET  /admin                           → panel HTML de administración (owner)
*    /admin/api/*                     → API del panel (owner-only)
GET  /devices/mine                    → dispositivos de la cuenta (owner|sub-admin)
POST /devices/{approve,reject,revoke,rename,cookies}
POST /pair                            → solicitar pareo (exige JWT si configurado)
GET  /pair/status?device_id=          → estado del pareo
GET  /yt/search?q=                    → búsqueda (con caché por query)
GET  /yt/prewarm?q=<ytId>[&download=1]→ pre-resolver URL / descargar m4a
GET  /stream/:id?yt=<ytId>            → stream de audio (caché archivo/URL)
GET  /download/:id?yt=<ytId>          → descarga a shared-audio
GET  /shared-cache/check?yt=id1,id2   → badge "en caché"
POST /cookies/upload                  → subir cookies.txt del propio device
POST /youtube/link/start|status, /youtube/unlink → login noVNC
```

## Ver también

- [[lan-server]] — implementación del servidor HTTP (código compartido).
- [[Tunnel-Cloudflared]] — túnel para exponer el servidor fuera de la LAN.
- [[Reproduccion-Servidor-24-7]] — flujo end-to-end.

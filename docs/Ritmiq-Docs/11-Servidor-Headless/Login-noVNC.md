---
tipo: aplicacion
capa: servidor
plataforma: servidor
estado: estable
ultima-revision: 2026-07-17
archivo: apps/login-agent/Dockerfile
tags: [servidor, youtube, cookies, novnc, playwright, docker]
---

# Login por navegador remoto (noVNC) — Fase 3b

> Vía para que un usuario **vincule su propia cuenta de YouTube** al servidor:
> un contenedor efímero levanta un navegador (Chromium) accesible por **noVNC**;
> el usuario inicia sesión y el agente captura sus cookies automáticamente.

## Componentes

### `apps/login-agent`

| Archivo | Qué |
|---|---|
| `Dockerfile` | Chromium + Xvfb + x11vnc + noVNC + Playwright |
| `entrypoint.sh` | arranca Xvfb, x11vnc, websockify/noVNC y el agente |
| `src/index.js` | agente Playwright: espera login, exporta cookies → Netscape → `POST /cookies/upload` |

### Orquestador (`server-core/youtube-login.js`)

`startLoginSession` / `getLoginStatus` / `stopLoginSession` / `isDockerAvailable`.
Levanta el contenedor **bajo demanda** con `docker run` (requiere el socket de
Docker montado en el servidor). El contenedor se **autodestruye** al terminar
(login OK o timeout ~5 min).

## Endpoints (device-auth)

```
POST /youtube/link/start     → arranca la sesión, devuelve la URL de noVNC
GET  /youtube/link/status    → estado (pending / linked / error)
POST /youtube/unlink         → borra las cookies del device (clearDeviceCookies)
```

## UI

`packages/ui/src/components/SettingsView/sections/YoutubeAccountSection.jsx`:
"Opción A — vincular con navegador" + polling de estado. También ofrece la
subida manual de `cookies.txt` (Opción B) y, en desktop remoto, aportar las
cookies del desktop (Opción C, ver [[Administracion-Dispositivos]]).

## Requisitos

```bash
docker build -f apps/login-agent/Dockerfile -t ritmiq-login:latest .
# El servidor necesita RITMIQ_LOGIN_IMAGE y el socket de Docker montado
# (docker-compose.yml monta /var/run/docker.sock).
```

## Aviso al usuario

Usar una cuenta de YouTube **sin 2FA / secundaria**: el 2FA/captcha complica el
flujo y las cookies dan acceso a la sesión.

## Seguridad (nota)

La pantalla noVNC hoy **no lleva contraseña**, pero es **efímera** (se apaga tras
~5 min o al vincular) y de **un solo dispositivo**. Exponla solo en la LAN o vía
túnel. Endurecerla con auth es una mejora futura.

## Ver también

- [[Administracion-Dispositivos]], [[device-cookies]], [[server-core]].

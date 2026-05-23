---
tipo: modulo
capa: desktop-preload
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/preload/index.cjs
tags: [desktop, preload, ipc, contextBridge]
---

# `preload/index.cjs`

> Script de preload de Electron. Expone `window.ritmiq` al renderer via `contextBridge`, encapsulando todos los canales IPC. Es el **único** puente entre la UI y el Node main.

## Ubicación
`apps/desktop/preload/index.cjs:1` (76 líneas)

## Por qué CJS

Electron exige preload en CommonJS aunque el resto del main esté en ESM.

## Por qué `contextBridge`

Con `contextIsolation: true` (configurado en [[index|main/index.js]]), el renderer NO puede acceder a `require`, `process`, ni `ipcRenderer`. `contextBridge.exposeInMainWorld` es la única forma segura de exponer funciones, y solo pasan valores serializables (sin funciones, sin DOM nodes).

## Mapping `window.ritmiq.*` ↔ canal IPC

| Namespace | Métodos | Canal IPC en [[ipc]] |
|---|---|---|
| `ritmiq.appInfo()` | (top-level) | `app:info` |
| `ritmiq.yt` | `metadata`, `streamUrl`, `search` | `yt:metadata`, `yt:streamUrl`, `yt:search` |
| `ritmiq.ytdlp` | `info`, `update` | `ytdlp:info`, `ytdlp:update` |
| `ritmiq.sharedCache` | `stats`, `clear` | `sharedCache:stats`, `sharedCache:clear` |
| `ritmiq.tunnel` | `status`, `setToken`, `setCustomUrl`, `start`, `startQuick`, `stop`, `onState` | `tunnel:*` + listener `tunnel:state` |
| `ritmiq.auth` | `token`, `regenerateToken` | `auth:token`, `auth:regenerateToken` |
| `ritmiq.library` | `list`, `addFromYoutube`, `addFromMetadata`, `download`, `undownload`, `fileSize`, `syncRemote`, `deleteRemote`, `onDownloadProgress` | `library:*` + listener `library:download:progress` |
| `ritmiq.devices` | `list`, `pending`, `approve`, `reject`, `revoke`, `forget`, `rename`, `activity`, `onPairRequest` | `devices:*` + listener `devices:pair-request` |
| `ritmiq.playlists` | `list`, `upsert`, `delete`, `tracks`, `addTrack`, `removeTrack`, `reorder`, `contents` | `playlists:*` |

## Anatomía del código (snippet clave)

### Patrón de listener push con unsubscribe
`apps/desktop/preload/index.cjs:26-30`

```js
onState: (cb) => {
  const handler = (_e, state) => cb(state);
  ipcRenderer.on('tunnel:state', handler);
  return () => ipcRenderer.removeListener('tunnel:state', handler);
},
```

**Por qué devolver una función de unsubscribe**: si el componente que se suscribe se desmonta y vuelve a montar (típico en React StrictMode o navegación), sin unsubscribe acumulás listeners. Cada `tunnel:state` se reenvía a 2, 3, N callbacks → trabajo duplicado y bugs sutiles donde el callback opera sobre estado stale.

**Uso típico en el renderer**:

```jsx
useEffect(() => {
  const unsub = window.ritmiq.tunnel.onState(setStatus);
  return unsub; // cleanup obligatorio
}, []);
```

El patrón se repite en `onDownloadProgress` y `onPairRequest`.

## Casos de borde

- **`window.ritmiq` indefinido**: pasa cuando el código corre en la PWA (no hay preload). El renderer detecta entorno con `typeof window.ritmiq !== 'undefined'` y enruta a IPC vs HTTP.
- **Llamar `invoke` con args no serializables** (función, DOM node, Promise): silenciosamente se pierde el arg o tira `Object could not be cloned`. Mantener payloads como JSON puro.
- **Listener registrado en main pero `removeListener` con función distinta**: no remueve nada y leak persiste. Por eso `handler` se captura en cierre y se reusa.

## Dependencias entrantes
- Renderer (todos los componentes, hooks y stores que tocan APIs nativas).

## Dependencias salientes
- `electron.contextBridge`.
- `electron.ipcRenderer`.

## Side-effects
- Define `window.ritmiq` en el renderer.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Olvidar exponer un método nuevo aquí tras añadirlo en [[ipc]] | El renderer recibe `TypeError: window.ritmiq.foo.bar is not a function`. |
| Olvidar el unsubscribe en un listener push | Leak de listeners al re-montar componentes; callbacks duplicados; el callback opera con state stale. |
| Cambiar la firma de un método sin actualizar callers en renderer | Argumentos llegan undefined → handler IPC los recibe vacíos → comportamiento inesperado. |
| Activar `contextIsolation: false` en [[index]] | El renderer pierde acceso a `window.ritmiq`, todas las features nativas se rompen. |

## Notas / Changelog
- 2026-05-22: nivel simple.

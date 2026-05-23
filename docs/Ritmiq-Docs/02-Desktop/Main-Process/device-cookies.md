---
tipo: modulo
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/main/device-cookies.js
tags: [desktop, devices, cookies, safe-storage]
---

# `main/device-cookies.js`

> Cifra/descifra cookies de YouTube **por dispositivo pareado**, las materializa como archivos Netscape por device en disco, y detecta cuándo caducaron por error de yt-dlp.

## Ubicación
`apps/desktop/main/device-cookies.js:1` (144 líneas)

## Por qué existe

Cada device pareado (PWA en iPhone, iPad, etc.) puede subir sus propias cookies de YouTube al desktop via [[lan-server]] `/cookies/upload`. Esto se persiste cifrado en `devices.cookies_blob`. Cuando el [[lan-server]] sirve un stream a ese device, escribimos sus cookies a un archivo temporal con permisos 600 para pasarlas a yt-dlp con `--cookies`.

## Exports

| Función | Devuelve | Cuándo usarla |
|---|---|---|
| `encryptCookies(plain)` | `Buffer` | Antes de persistir en SQLite |
| `decryptCookies(blob)` | `string \| null` | Antes de escribir el file Netscape |
| `getCookieFileForDevice(device)` | `string \| null` | En cada request de stream del device |
| `invalidateDeviceCookies(deviceId)` | `void` | Al revocar/olvidar/actualizar cookies |
| `looksLikeCookieExpired(stderr)` | `boolean` | Tras un fallo de yt-dlp para decidir si pedir re-subida |

## Seguridad: safeStorage por plataforma

| Plataforma | Backend |
|---|---|
| Linux | `gnome-keyring` / `kwallet` (D-Bus) |
| macOS | Keychain |
| Windows | DPAPI |

Si el keyring no responde (Linux con headless, user no logueado en sesión gráfica): cookies se guardan **plaintext** con prefijo `'plain:'` y se loguea un warning **una sola vez** por proceso.

## Anatomía del código (snippets clave)

### 1. Cifrado con fallback marcado
`apps/desktop/main/device-cookies.js:44-51`

```js
export function encryptCookies(plain) {
  if (!plain) return Buffer.alloc(0);
  if (isSafeStorageReady()) {
    return safeStorage.encryptString(plain);
  }
  // Marca "plain:" en los primeros 6 bytes para distinguir en decrypt.
  return Buffer.concat([Buffer.from('plain:', 'utf8'), Buffer.from(plain, 'utf8')]);
}
```

**Por qué marcador `'plain:'` y no un flag aparte**: nos permite mezclar Buffers cifrados y planos en la misma columna `cookies_blob` y discriminar al leer sin schema extra. El prefijo `plain:` es muy improbable como primeros 6 bytes de un payload cifrado por safeStorage (que produce bytes random).

### 2. Descifrado tolerante a fallos de keyring
`apps/desktop/main/device-cookies.js:58-74`

```js
export function decryptCookies(blob) {
  if (!blob || blob.length === 0) return null;
  if (blob.length >= 6 && blob.slice(0, 6).toString('utf8') === 'plain:') {
    return blob.slice(6).toString('utf8');
  }
  if (isSafeStorageReady()) {
    try { return safeStorage.decryptString(blob); }
    catch (err) {
      console.warn('[device-cookies] decrypt failed:', err.message);
      return null;
    }
  }
  // Si llega aqui es que el cifrado se hizo con safeStorage en una sesion
  // anterior pero ahora no esta disponible (keyring caido). No podemos
  // descifrar. Tratar como sin cookies para fallback.
  return null;
}
```

**El edge case más feo**: el blob fue cifrado por safeStorage en sesión anterior con keyring activo, pero hoy el keyring está caído. No podemos descifrar y no podemos rotar a `'plain:'` sin las cookies originales. Único camino: devolver `null` → la PWA recibirá `Sign in to confirm` en el próximo play y volverá a subir cookies.

### 3. Cache de archivos por device con invalidación por timestamp
`apps/desktop/main/device-cookies.js:97-111`

```js
export function getCookieFileForDevice(device) {
  if (!device?.cookies_blob) return null;
  const updatedAt = device.cookies_updated_at ?? '';
  const hit = fileCache.get(device.device_id);
  if (hit && hit.updatedAt === updatedAt && existsSync(hit.path)) {
    return hit.path;
  }
  const text = decryptCookies(device.cookies_blob);
  if (!text) return null;
  const p = join(cookiesDir(), `${device.device_id}.txt`);
  writeFileSync(p, text, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(p, 0o600); } catch {}
  fileCache.set(device.device_id, { path: p, updatedAt });
  return p;
}
```

**Por qué Map en memoria + check de existsSync**: el cache es process-local. Si el desktop reinicia, el cache se pierde y regeneramos. El `existsSync` extra protege contra borrados externos (alguien hizo `rm` del file mientras corremos).

**Por qué `mode: 0o600` + `chmodSync(0o600)` duplicado**: `writeFileSync` con `mode` no siempre lo aplica si el archivo ya existía (depende de OS). El `chmodSync` posterior garantiza permisos restrictivos: solo el owner del proceso lee/escribe.

### 4. Detección heurística de cookies caducadas
`apps/desktop/main/device-cookies.js:133-143`

```js
export function looksLikeCookieExpired(stderrOutput) {
  if (!stderrOutput) return false;
  const lower = String(stderrOutput).toLowerCase();
  return (
    lower.includes('sign in to confirm') ||
    lower.includes('age-restricted') ||
    lower.includes('http error 401') ||
    lower.includes('http error 403') ||
    lower.includes('login required') ||
    lower.includes('http_403_forbidden')
  );
}
```

**Por qué heurística sobre stderr**: yt-dlp no tiene un exit code distintivo para "cookies caducadas". Tenés que parsear strings. La lista no es exhaustiva — captura los mensajes más frecuentes. Si aparecen falsos negativos (cookies caducadas no detectadas) añadir patrones aquí.

**Cuándo se llama**: el [[lan-server]] tras un fallo de yt-dlp en `/stream/` o `/download/`. Si `true` → pedir a la PWA que vuelva a subir cookies. Si `false` → el error es otro (red, video privado, etc.).

## Casos de borde y gotchas

- **safeStorage degrada a plaintext en runtime**: si el keyring se cae en medio de una sesión, los `encryptCookies` siguientes producen `'plain:'`. No es ideal pero la app sigue funcionando.
- **Cookies subidas con safeStorage, sesión sin keyring**: blob no descifrable → `getCookieFileForDevice` devuelve `null` → stream falla → user re-sube.
- **Archivo borrado a mano por el usuario**: `existsSync` falla en cache → regeneramos.
- **Race de updates simultáneos del mismo device**: si dos requests escriben el archivo a la vez, `writeFileSync` el último gana. Contenido idéntico → no afecta.
- **Cookies > 1MB**: no hay límite aquí. El límite vive en [[lan-server]] `/cookies/upload`. Llamadas directas a `getCookieFileForDevice` con blobs gigantes funcionan sin guardrail.

## Dependencias entrantes
- [[ipc]] → `devices:revoke` y `devices:forget` llaman `invalidateDeviceCookies`.
- [[lan-server]] → `/stream/` resuelve device, lee `cookies_blob`, llama `getCookieFileForDevice`. Tras fallo de yt-dlp consulta `looksLikeCookieExpired`. En `/cookies/upload` llama `encryptCookies` (vía [[devices]]) + `invalidateDeviceCookies`.
- [[devices]] → guarda `cookies_blob` cifrado en `updateDeviceCookies` (caller debe pasar Buffer ya cifrado).

## Dependencias salientes
- `electron.app.getPath('userData')`, `electron.safeStorage`.
- `node:fs` (`writeFileSync`, `chmodSync`, `unlinkSync`, `existsSync`).

## Side-effects
- Escribe `<userData>/device-cookies/<id>.txt` con permisos 600.
- Borra archivos en `invalidateDeviceCookies`.
- Warn único en consola si safeStorage no está disponible.

## Errores manejados
- `safeStorage` no disponible → fallback plaintext + warning único.
- `safeStorage.decryptString` falla → `console.warn` + null.
- `chmodSync` falla → ignorado.
- `unlinkSync` falla en `invalidateDeviceCookies` → ignorado.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar el marcador `'plain:'` | Blobs viejos plaintext se intentan descifrar con safeStorage → `decrypt failed` masivo → devices pierden cookies. |
| Olvidar `invalidateDeviceCookies` al revocar | Archivos huérfanos en `<userData>/device-cookies/`. No afectan auth (revocado ya no autentica) pero ocupan disco. |
| Cambiar `mode: 0o600` a 0o644 | Otros usuarios del mismo OS pueden leer cookies de YouTube de tu sesión. |
| Eliminar el cache (Map) | Se reescribe el file en cada request de stream → IO en cada play, ~ms extra por request. |
| Quitar `looksLikeCookieExpired` | UI no detecta caducidad → user ve "error desconocido" en lugar de "subí cookies nuevas". |

## Notas / Changelog
- 2026-05-22: nivel medio.

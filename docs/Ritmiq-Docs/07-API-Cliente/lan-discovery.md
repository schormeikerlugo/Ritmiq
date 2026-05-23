---
tipo: modulo
capa: api
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/api/src/lan-discovery.js
tags: [api, lan, discovery, red]
---

# `api/lan-discovery.js`

> Descubrimiento del servidor LAN del Desktop desde el cliente (PWA o renderer). Prueba IPs guardadas en localStorage y candidatos extra; persiste la que responda.

## Ubicación
`packages/api/src/lan-discovery.js:1` (59 líneas)

## Estrategia de descubrimiento

1. **localStorage**: la URL del último PC conocido (`ritmiq:lan:lastBaseUrl`). Primer intento — suele ser correcto si la red no cambió.
2. **Candidatos extra** (`opts.candidates`): IPs/URLs pasadas por el caller (ej. detectadas vía IPC del main Electron, o ingresadas manualmente en Settings).
3. **Futuro**: endpoint en Supabase donde el Desktop registra su IP local (no implementado).

**No hay mDNS desde el browser**: los navegadores no exponen mdns-sd. La PWA en Safari no puede hacer browse de `_ritmiq._tcp`. Esa búsqueda solo puede hacerla el proceso main de Electron (que sí tiene acceso a Node). El renderer Electron pasa las IPs descubiertas al paso 2.

## Exports

### `discoverLanServer(opts?): Promise<string | null>`

```js
async function discoverLanServer({
  candidates?: string[]  // IPs/URLs extra a probar
}): Promise<string | null>  // base URL del server o null
```

Prueba en orden: `[localStorage, ...candidates]`. Primer éxito (`/health` responde OK en < 600ms) → retorna esa URL.

### `rememberLanServer(baseUrl): void`

Guarda en `localStorage`. Llamar cuando se confirma una URL que funciona.

### `forgetLanServer(): void`

Borra de `localStorage`. Llamar al desconectar o en Settings "Olvidar servidor LAN".

## Anatomía del código (snippet clave)

### `ping`: timeout de 600ms
`packages/api/src/lan-discovery.js:20-31`

```js
async function ping(baseUrl, timeoutMs = 600) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

**Por qué 600ms**: balanceo entre UX (no hacer esperar al usuario) y realidad de red (WiFi con algo de latencia puede tardar 200-400ms). Si hay 3 candidatos y todos fallan a 600ms = 1.8s de espera total. Aceptable.

**Por qué `AbortController` y no `Promise.race([fetch, timeout])**: `Promise.race` con un timeout fake no cancela la request fetch — sigue corriendo en background y consumiendo recursos. `AbortController` cancela la request real.

**Por qué `return false` en catch**: red caída, CORS error, DNS failure — todos deberían ser silenciosos. El discovery es best-effort.

## Casos de borde y gotchas

- **IP guardada pero en red distinta**: el usuario llegó a casa (192.168.0.x) pero ayer estaba en trabajo (192.168.1.x). El ping falla en 600ms, retorna null, y el caller muestra "No se encontró el desktop". El usuario debe ingresar la nueva IP en Settings.
- **Desktop en misma red pero firewall bloquea 3939**: el ping falla. Idéntico al caso anterior desde el punto de vista del código.
- **Múltiples candidatos**: todos se prueban secuencialmente (no en paralelo). Para 3 candidatos = máx 3 × 600ms = 1.8s. Mejora posible: `Promise.any([ping(c1), ping(c2), ping(c3)])`.
- **CORS**: el endpoint `/health` tiene `Access-Control-Allow-Origin: *` en el [[lan-server]] → no hay problema de CORS desde el browser.
- **`localStorage` no disponible**: en tests con jsdom sin storage configurado, `localStorage.getItem` tira. El código no tiene try/catch alrededor — crash en ese entorno. Mitigación: añadir wrapper si se testea.

## Dependencias entrantes
- [[lan-client|ui/lib/lan-client]] — usa `discoverLanServer` para establecer conexión.
- [[connectivity|ui/lib/connectivity]] — puede llamar periódicamente para detectar que el Desktop volvió a estar disponible.

## Dependencias salientes
- `fetch` API (browser nativo).
- `localStorage` (browser nativo).
- `AbortController` (browser nativo).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Aumentar timeout a 3000ms | Discovery de 3 candidatos tarda 9s → UX inaceptable. |
| Prueba en paralelo sin `Promise.any` correctamente | Si todas fallan, necesitás esperar que todas terminen igual. |
| Olvidar `clearTimeout(timer)` en `finally` | Timer queda pendiente después del fetch → memory/handle leak. |
| Cambiar `STORAGE_KEY` sin migración | La URL guardada en la clave vieja se pierde → re-discovery manual cada sesión. |

## Notas / Changelog
- 2026-05-22: nivel medio.

---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/resolve-stream/index.ts
tags: [edge, youtube, innertube, streaming, audio]
---

# `resolve-stream`

> Resuelve URL de stream de audio de YouTube vía la API interna Innertube. Usa cliente IOS/ANDROID (no WEB) para evitar `signatureCipher` que requiere ejecutar JS. Soporta modo proxy con Range.

## Ubicación
`supabase/functions/resolve-stream/index.ts:1` (197 líneas)

## Endpoints

```
GET /resolve-stream?ytId=<id>           → JSON { url, contentType }
GET /resolve-stream?ytId=<id>&proxy=1   → Proxy de bytes con Range
```

## Por qué cliente IOS/ANDROID

YouTube entrega URLs sin signature cipher al cliente móvil. Descifrar el cipher requiere ejecutar el `player.js` (~3MB de código), inviable en Deno Edge. Los clientes móviles devuelven URLs ya firmadas listas para usar.

## Cascada de clientes

```js
CLIENTS = [
  { name: 'IOS',     userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; ...)' },
  { name: 'ANDROID', userAgent: 'com.google.android.youtube/19.44.38 (...)' },
  { name: 'WEB',     userAgent: 'Mozilla/5.0 ...' },
];
```

Para cada cliente: POST `https://www.youtube.com/youtubei/v1/player` con el body de contexto correcto + API key. Si `streamingData.adaptiveFormats` contiene `audio/mp4` con `url` directa → éxito.

## Selección de formato

```js
const audioMp4 = formats.filter(f =>
  f.mimeType?.startsWith('audio/mp4') && typeof f.url === 'string'
);
audioMp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
return audioMp4[0];
```

**Por qué audio/mp4 (m4a)**: iOS Safari NO decodifica opus/webm. m4a/AAC es universal.

## Modo proxy

`?proxy=1` hace que el Edge fetch el stream desde su IP y reenvíe los bytes al cliente, manteniendo Range para seek. Usa el User-Agent del cliente WEB.

**Por qué proxy**: la URL directa de googlevideo está IP-locked al cliente que la pidió. Cuando el Edge la pide, queda locked a la IP del Edge → puede reenviarla con esa misma IP.

## Casos de borde

- **Video con DRM / region-locked**: `playabilityStatus.status === 'ERROR'` → siguiente cliente.
- **Todos los clientes fallan**: 502 con mensaje "No se pudo obtener URL de audio sin cifrar".
- **Range request**: se propaga al upstream y se reenvía con el status de upstream (206 partial content).

## Invocado desde

- [[audio-source|core/audio-source]] → `resolveCloudStream` en PWA cuando no hay LAN/Tunnel.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Solo cliente WEB | Casi todos los videos llegan con `signatureCipher` → no se pueden reproducir sin descifrar. |
| Sin fallback IOS → ANDROID → WEB | Un único cliente caído rompe toda la reproducción en PWA. |
| Selector que prefiere opus | iOS Safari no decodifica → audio en silencio aunque la barra avance. |

## Notas / Changelog
- 2026-05-22: nivel pleno.

---
tipo: modulo
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/url-rewrite.js
tags: [helper, url, red, supabase-local]
---

# `lib/url-rewrite.js`

> Reescribe URLs que apuntan a `127.0.0.1`/`localhost` al hostname actual de la página. Resuelve el problema de Supabase Local en dev cuando la PWA carga desde una IP de LAN.

## Ubicación
`packages/ui/src/lib/url-rewrite.js:1` (29 líneas)

## El problema que resuelve

```
Supabase local: http://127.0.0.1:54321 (guardado en .env y en DB)
PWA cargando en: http://192.168.68.50 (el móvil en la misma WiFi)
```

Las portadas (`cover_url`) y playlists covers guardados en Supabase Storage local tienen URLs con `127.0.0.1`. Cuando el móvil las intenta cargar, `127.0.0.1` apunta al propio móvil → 404. `rewriteHost` cambia el hostname al de la página actual.

## Firma

```js
function rewriteHost(url: string | null | undefined): string | null | undefined
```

Retorna `url` sin cambios si:
- `url` es null/undefined.
- No apunta a loopback.
- La propia página también corre en loopback (dev desktop).

## Usado en

- [[sync|ui/lib/sync]] → `rowToTrack` y `rowToPlaylist` aplican `rewriteHost` en `coverUrl` al deserializar.
- [[api|ui/lib/api]] → `rowToTrack` en el path PWA.
- [[track-helpers]] → `metaToCandidate` aplica en el thumbnail.
- [[supabase|ui/lib/supabase]] → `resolveSupabaseUrl` aplica la misma lógica a la URL del cliente Supabase.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar la check `!pageIsLoopback` | Desktop (donde la página SÍ corre en localhost) tiene sus URLs reescritas → 404 para portadas locales. |

## Notas / Changelog
- 2026-05-22: nivel simple.

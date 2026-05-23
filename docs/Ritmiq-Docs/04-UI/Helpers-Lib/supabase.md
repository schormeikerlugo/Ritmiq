---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/supabase.js
tags: [helper, supabase, singleton, cliente]
---

# `lib/supabase.js`

> Singleton del cliente Supabase para la UI. Lee URL y anon key de variables Vite, aplica `rewriteHost` si la URL apunta a loopback y la app corre desde LAN.

## Ubicación
`packages/ui/src/lib/supabase.js:1` (44 líneas)

## Export

```js
export const supabase: SupabaseClient
```

Singleton creado via [[supabase|packages/api/src/supabase.js#createSupabase]].

## Reescritura de URL en dev LAN

```js
// Si .env tiene VITE_SUPABASE_URL=http://127.0.0.1:54321
// y la PWA carga desde http://192.168.68.50
// → el cliente apunta a http://192.168.68.50:54321
```

Permite testear la PWA en el móvil contra Supabase local sin cambiar el `.env`. La misma lógica que [[url-rewrite]].

## Variables de entorno

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública (anon) |

## Usado por

Prácticamente todos los módulos de UI que tocan Supabase: [[auth]], [[library]], [[playlists]], [[history]], [[social]], [[sync]], [[realtime]], [[connectivity]], [[connection]], [[tunnel-registry]], [[use-presence]], [[use-social-realtime]], [[recommendations]].

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Crear dos instancias en lugar de un singleton | Dos instancias con auth state independiente → logs de sesión y listeners duplicados. |
| Quitar la reescritura de URL | PWA en móvil + Supabase local → todas las llamadas fallan con "connection refused" a 127.0.0.1. |

## Notas / Changelog
- 2026-05-22: nivel simple.

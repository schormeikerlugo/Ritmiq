---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, auth, login, sesion, realtime]
---

# Login y sesión — carga inicial de la app

> Flujo desde que el usuario se autentica hasta que la app tiene toda la data cargada (library, playlists, social, history) y conexiones Realtime activas.

## Diagrama

```mermaid
sequenceDiagram
  participant U as Usuario
  participant App as App.jsx
  participant Auth as auth store
  participant SB as Supabase Auth
  participant Lib as library store
  participant Pls as playlists store
  participant Hist as history store
  participant Soc as social store
  participant RT as realtime + use-social-realtime
  participant Push as use-push

  U->>App: abre la app
  App->>Auth: init()
  Auth->>SB: getSession() (caché localStorage)
  Auth->>SB: getUser() (valida contra servidor)
  alt sesión válida
    SB-->>Auth: { user, email }
    Auth->>Auth: subscribe onAuthStateChange
    Auth-->>App: user

    par carga paralela
      App->>Lib: load()
      Lib->>SB: pullTracks()
      Lib->>App: SQLite local merge (Desktop) o IndexedDB cache (PWA)
    and
      App->>Pls: load()
      Pls->>SB: pullPlaylists + pullPlaylistContents
      Pls->>Pls: auto-crear 'Favoritas' si falta
    and
      App->>Hist: load()
      Hist->>Hist: flushOffline
      Hist->>SB: SELECT play_history LIMIT 500
    and
      App->>Soc: loadProfile + loadFriends + loadRequests + loadInbox
      Soc->>SB: queries paralelas
    end

    App->>RT: realtime.start(userId, handlers)
    RT->>SB: subscribe channels tracks/playlists/playlist_tracks
    App->>RT: useSocialRealtime(userId)
    RT->>SB: subscribe channels presence/friendships/shared_items

    App->>Push: usePushRegistration(userId)
    Push->>Push: syncSubscription
    Push->>SB: UPSERT push_subscriptions

  else sesión inválida (db reset, etc.)
    SB-->>Auth: error
    Auth->>SB: signOut()
    Auth-->>App: user = null
    App->>App: render <AuthScreen />
  end
```

## Decisiones documentadas

- **`getUser()` después de `getSession()`** ([[auth#init]]) — la caché localStorage puede estar stale tras `db reset`. La validación contra servidor detecta sesiones inválidas.
- **Carga paralela** — library, playlists, history, social cargan en paralelo. Total ~500ms-2s.
- **Hidratación Dexie en PWA primero** ([[library#load]], [[playlists#load]]) — UI reactiva al instante, Supabase pull en background.
- **Auto-crear Favoritas** ([[playlists#load]]) — si la playlist no existe (sesión nueva), se crea automáticamente; FK 23503 = sesión inválida → sign-out forzado.
- **Realtime tras data inicial** — evita race entre `load` y eventos `applyRemote`.

## Módulos involucrados

- [[Auth]] componente, [[AuthScreen]].
- Stores: [[auth]], [[library]], [[playlists]], [[history]], [[social]].
- Hooks: [[use-social-realtime]], [[use-push]], [[use-presence]].
- Helpers: [[realtime]], [[sync]], [[supabase|ui/lib/supabase]].

## Notas / Changelog
- 2026-05-22: F8.

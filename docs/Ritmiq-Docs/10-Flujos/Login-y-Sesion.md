---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-26
tags: [flujo, auth, login, sesion, realtime, forgot-password, reset-password]
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

## Flujo de recuperación de contraseña

```mermaid
sequenceDiagram
  participant U as Usuario
  participant App as App.jsx
  participant Forgot as ForgotPasswordView
  participant Reset as ResetPasswordView
  participant SB as Supabase Auth
  participant Mail as Correo del usuario

  U->>Forgot: "¿Olvidaste tu contraseña?"
  Forgot->>SB: resetPasswordForEmail(email, redirectTo=#reset-password)
  SB->>Mail: envía link mágico (válido 1 hora)
  Forgot-->>U: "Revisa tu correo"
  U->>Mail: abre correo
  Mail->>App: click en link → app abre con #reset-password
  App->>SB: valida token, crea sesión temporal
  SB-->>App: onAuthStateChange('PASSWORD_RECOVERY')
  App->>Reset: renderiza ResetPasswordView (override del shell normal)
  U->>Reset: nueva contraseña + confirm
  Reset->>SB: updateUser({ password })
  SB-->>Reset: OK
  Reset->>SB: signOut() (cierra sesión de recovery)
  Reset->>App: redirect "/" → AuthScreen signin
  U->>App: ingresa con la nueva contraseña
```

## Vistas del AuthScreen

| Vista | Trigger | Acción |
|---|---|---|
| `SignInView` (default) | apertura del shell sin sesión | `signIn(email, password)` |
| `SignUpView` | click en "Crear una" | `signUp(email, password, { username, displayName })` con username obligatorio |
| `ForgotPasswordView` | click en "¿Olvidaste tu contraseña?" | `resetPassword(email)` |
| `ResetPasswordView` | URL hash `#reset-password` o evento `PASSWORD_RECOVERY` (renderizado por App.jsx, no por el shell) | `updatePassword(newPassword)` |

## Notas / Changelog
- 2026-05-26: Añadido flujo de recovery (ForgotPasswordView + ResetPasswordView). El shell del AuthScreen ahora soporta 3 modos (signin/signup/forgot). Documentación actualizada en [[Auth]].
- 2026-05-22: F8.

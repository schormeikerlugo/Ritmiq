---
tipo: adr
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-28
tags: [adr, decisiones]
---
# ADR — Decisiones Técnicas

Cada decisión sigue el formato:

> **ADR-NNN — Título**
> Contexto · Decisión · Consecuencias.

## ADR-001 — Monorepo pnpm + Turbo

- **Contexto**: dos clientes (Desktop, PWA) comparten ~80% del código de UI y lógica.
- **Decisión**: monorepo con `apps/*` y `packages/*` en pnpm workspaces + Turbo.
- **Consecuencias**: un solo `pnpm install`, scripts cacheados, riesgo de acoplar packages → mitigado con boundaries por dominio (ui/core/db/api/yt).

## ADR-002 — JavaScript + JSDoc en vez de TypeScript

- **Contexto**: Electron + Vite + nativos. TS suma fricción de build en multiplataforma.
- **Decisión**: JS ESM con JSDoc en módulos críticos (`core`, `db`, `yt`).
- **Consecuencias**: menos seguridad de tipos en compile-time, pero IntelliSense suficiente. Reevaluar si el proyecto crece > 50k LOC.

## ADR-003 — yt-dlp embebido solo en Desktop

- **Contexto**: PWA no puede ejecutar binarios. Resolver streams desde el cliente sería bloqueado por CORS.
- **Decisión**: Desktop usa yt-dlp local; PWA usa Edge Function [[resolve-stream]] + LAN del Desktop como fallback rápido.
- **Consecuencias**: dependencia de Edge Function en PWA (cuesta invocaciones), pero permite reproducir sin Desktop encendido.

## ADR-004 — Howler en Desktop, HTML Audio en PWA

- **Contexto**: iOS Safari tiene comportamientos peculiares con Web Audio y MediaSession.
- **Decisión**: Desktop usa [[howler-backend]]; PWA usa [[html-audio-backend]] directo.
- **Consecuencias**: dos backends que mantener pero ambos delgados detrás de la misma interfaz en [[player|core/player]].

## ADR-005 — Cloudflared para tunneling

- **Contexto**: usuario quiere escuchar fuera de casa sin VPN ni router config.
- **Decisión**: ejecutar `cloudflared` como subproceso del main de Desktop.
- **Consecuencias**: dependencia externa, pero gratis y estable. Alternativas evaluadas: tailscale, ngrok, propio relay. Documentado en [[cloudflared]].

## ADR-006 — Supabase como BaaS

- **Contexto**: necesitamos auth + DB + storage + realtime + edge functions sin operar infra.
- **Decisión**: Supabase (Postgres + Auth + Storage + Edge + Realtime).
- **Consecuencias**: vendor lock-in moderado (Postgres es portable, Auth y RLS no). Free tier alcanza para uso personal.

## ADR-007 — Zustand + TanStack Query

- **Contexto**: necesitábamos estado global ligero y cache de red.
- **Decisión**: Zustand para 16 slices (`player`, `library`, `social`, …) + TanStack Query para fetch.
- **Consecuencias**: stores muy granulares (ver [[MOC - UI Compartida]]); evita prop drilling.

## ADR-008 — GSAP como motion engine

- **Contexto**: las transiciones CSS funcionaban pero no había una API uniforme para componer secuencias (stagger, timelines, cleanup en unmount React) ni un único lugar donde gestionar `prefers-reduced-motion`.
- **Decisión**: instalar `gsap@3.15.0` en `@ritmiq/ui` y centralizar todas las animaciones de entrada de vista vía el hook [[use-view-transition]]. Las animaciones de keyframes CSS se mantienen donde ya estaban (modales, BottomSheet) sin migrar.
- **Consecuencias**: +66 KB gzipped al bundle inicial. `gsap.matchMedia()` cubre reduced-motion automáticamente. Se evita añadir `@gsap/react` (otra dep) usando `useEffect + ctx.revert()` manual. Code-splitting de GSAP queda para Fase 7 si el peso molesta.

## ADR-009 — `CoverArt` primitive con gradient hash determinístico

- **Contexto**: tracks sin `coverUrl` mostraban un hueco gris o un icono `<Music>` plano. Las cards de la Home y la mini-player se veían rotas para tracks importados sin thumbnail.
- **Decisión**: nuevo primitive [[CoverArt]] que computa un gradient HSL a partir de un hash FNV-1a del `seed` (título o artista) + iniciales centradas. Mismo seed = mismo gradient siempre.
- **Consecuencias**: visualmente consistente entre sesiones. Migración incremental: el mini-player original quedó revertido a `<img>` directo para conservar el `vinyl-spin` animation (ver commit `270da70`). `CoverArt` se usa en `TrackCard`, `YtPlaylistView`, `HistoryView`, `MonthlyWrapped`.

## ADR-010 — Virtualización propia en `ListView` (sin react-window)

- **Contexto**: la `Library` con > 200 tracks empezaba a notar jank en mobile. Necesitábamos virtualización.
- **Decisión**: implementar la virtualización dentro de [[ListView]] con `ResizeObserver` + slice de items visibles + spacers top/bottom + throttle por `requestAnimationFrame`. **No** se instala `react-window` ni `@tanstack/react-virtual`.
- **Consecuencias**: 0 KB extra al bundle. Limitación V1: `itemHeight` uniforme. Si en el futuro hace falta altura variable, evaluar `@tanstack/react-virtual` (~10 KB gzip). El primitive es opt-in: `virtualize=false` por default para listas pequeñas.

## ADR-011 — `withRetry` con clasificación de errores transitorios

- **Contexto**: las llamadas a Edge Functions que dependen de Last.fm e Innertube tienen ~3% de tasa de error 5xx/429. Cada store manejaba el fallo distinto; el usuario veía `ErrorState` para errores que se resolverían en el siguiente intento.
- **Decisión**: helper genérico [[with-retry]] en `packages/ui/src/lib/`. Backoff exponencial 500ms→1s→2s con jitter 20%. Clasificador `defaultIsRetriable` reconoce 5xx/408/429 + `TypeError` de red. Integrado en `recommendations`, `artist`, `yt-playlist` stores.
- **Consecuencias**: errores transitorios desaparecen del UX sin coste perceptible. Cancellation via `AbortSignal`. Es responsabilidad del caller decidir maxAttempts (default 3). El bundle delta es despreciable (~1 KB).

## ADR-012 — Crossfade simulado con dos fades secuenciales

- **Contexto**: el usuario quería transiciones suaves entre tracks. Crossfade real requiere dos `<audio>` solapados + WebAudio graph + reescritura del flujo en [[use-player|use-player.js]]. El flujo actual es delicado en iOS background.
- **Decisión**: componer dos fades sobre el único `<audio>` existente:
  1. **fade-OUT** cuando `positionSeconds` entra en `dur - crossfadeSeconds`.
  2. **fade-IN** cuando arranca el nuevo `currentTrack`.
  Ambos en [[use-crossfade]] vía `setInterval @ 30Hz` para resistir background throttling de Electron.
- **Consecuencias**: percepción de cruce continuo sin tocar el backend de audio. **No es crossfade real** — está documentado explícitamente en el header del hook. Si en el futuro se justifica el coste de duplicar `<audio>`, hacerlo en un commit propio con su propio ADR.

## ADR-013 — Curva del EQ aproximada con gaussianas y sigmoides

- **Contexto**: el EQ ya existía (6 bandas BiquadFilter). Faltaba visualizar la forma de la curva combinada para que el usuario entienda qué hace cada preset.
- **Decisión**: componente [[EqCurve]] que suma respuestas analíticas:
  - `peaking` → gaussiana en escala log-freq con ancho derivado del Q.
  - `lowshelf` / `highshelf` → sigmoide (logística).
  - 80 samples interpolados, eje X log10(20Hz..20kHz), eje Y dB clamped al rango de sliders.
- **Consecuencias**: SVG estático que reacciona en tiempo real a los sliders sin tocar `AudioContext`. **No reproduce la respuesta exacta de BiquadFilter** — la API correcta sería `BiquadFilterNode.getFrequencyResponse()`, pero requiere un graph activo y muestreo en cada cambio. Aceptable porque el componente es un **indicador visual**, no un analizador profesional.

## ADR-014 — Drag-and-drop con HTML5 native (no dnd-kit cross-context)

- **Contexto**: `@dnd-kit` ya está en uso en `PlaylistView` y `QueuePanel` para sortable interno. Necesitábamos drag desde `Library` hacia los items del `Sidebar` (cross-context entre dos zonas con su propio scroll).
- **Decisión**: usar HTML5 native drag API con MIME custom `application/x-ritmiq-track`. `Library` rows: `draggable=true` + `setData`. `Sidebar` playlist items: `onDragOver`/`onDrop`. Highlight visual con `data-drag-over=true`.
- **Consecuencias**: 0 KB extra. Cero interferencia con el sortable de dnd-kit. Funciona en desktop (mouse) y mobile WebView (touch). Si en el futuro queremos `DragOverlay` consistente con el resto, migrar `PlaylistView` también a HTML5 o aceptar la heterogeneidad.

## ADR-015 — Lazy-init del WebAudio graph + auto-init en gestos de usuario

- **Contexto**: el backend [[html-audio-backend]] crea el `AudioContext + MediaElementSource + Analyser` solo cuando alguien llama a `ensureGraph()`. Una vez creado, el audio del `<audio>` pasa siempre por el graph (no se puede volver atrás). Riesgo de regresión en iOS background → init lazy deliberado.
- **Decisión**: cada feature que requiere el `AnalyserNode` (EQ, Visualizer, BPM Pulse) tiene la responsabilidad de invocar `backend.initGraphFromGesture()` **sincrónicamente dentro de un onClick** del usuario. iOS Safari y Electron requieren ese token de gesto para hacer `resume()` del AudioContext.
- **Consecuencias**: si el toggle no se activa dentro de un gesto, el graph queda `suspended` → silencio. El patrón se replica en `PlaybackSection.handleEqToggle` y `NowPlaying.handleVisualizerToggle`. [[use-bpm-pulse]] usa polling de re-attach hasta 8 veces para enganchar al graph cuando otro feature lo cree después.

## ADR-016 — Code-splitting por ruta con `React.lazy` + `Suspense`

- **Contexto**: el bundle inicial de la PWA llegó a 1.1 MB raw / 323 KB gzipped tras Fase 5. Muchas vistas (Settings, Stats, Friends, Profile, etc.) son baja frecuencia y aumentaban el TTI sin justificación.
- **Decisión**: separar las vistas en chunks vía `lazy(() => import(...).then(m => ({ default: m.X })))` por named exports. Wrapping con `<Suspense fallback={<TrackRowSkeleton/>}>` para vistas con UI; `fallback={null}` para componentes invisibles condicionalmente (Auth, Onboarding, MonthlyWrapped). Vistas eager: Home, Library, PlaylistView, SearchView, Player, TopBar, Sidebar, BottomNav, NowPlaying, QueuePanel, ToastHost, AuthScreen → split en Fase 7.2 incluso esta última.
- **Consecuencias**: bundle inicial 931 KB raw / 287 KB gzipped (-17% / -11%). 13 chunks lazy generados (~144 KB raw fuera del boot). Microparada de 50-200ms al navegar a vista lazy por primera vez (skeleton durante descarga); imperceptible tras 2da visita por SW cache.

## ADR-017 — CSS Container Queries para componentes responsive al contenedor

- **Contexto**: las cards del Home (HomeRow + RowSkeleton) usaban `@media (max-width: 640px)` para encoger. En desktop, abrir el queue panel reducía el main panel ~340px pero las cards mantenían 180px porque el viewport seguía siendo > 640px.
- **Decisión**: migrar `HomeRow.module.css` y `RowSkeleton.module.css` a `container-type: inline-size` + `container-name: home-row` + `@container home-row (max-width: 640px)`. **No** se migran los media queries que sí son por preferencia mobile vs desktop (ej. ocultar quick-play en mobile).
- **Consecuencias**: cards encogen cuando el queue panel se abre, sin nuevo media query. Sin fallback explícito: browsers viejos (~1% del tráfico) ven cards en 180px siempre — degradación gradual aceptable. Soporte: Chrome 105+ (Electron 33 ✅), Safari 16+, Firefox 110+.

## ADR-018 — Playwright para E2E + suite skeleton (sin CI gate todavía)

- **Contexto**: cero E2E al cerrar Fase 6. Las regresiones de boot (chunk error, SW broken, módulos rotos por refactor) se descubrían en mano. Necesitábamos al menos un smoke automatizable.
- **Decisión**: instalar `@playwright/test` en `apps/pwa` (devDependency). Config con `chromium only` V1, auto-arranca `vite preview`. Suite V1: smoke (boot + AuthScreen visible + code-splitting valido). Tests V2 (Auth, Play, Share flows) documentados en `e2e/README.md` como follow-up que requieren seed user en Supabase o mocks MSW.
- **Consecuencias**: la suite **no está integrada a CI** todavía. Se corre manualmente con `pnpm run test:e2e`. Cuando se decida agregarla a GitHub Actions, hacer cache de `~/.cache/ms-playwright` para evitar descargar Chromium en cada run. Si la suite V2 requiere DB live, evaluar mover a un proyecto Supabase de test separado.

## ADR-019 — Sync de Jam mode via Realtime broadcast + drift compensation (no WebRTC)

- **Contexto**: en el [[Jam-Mode]] cada cliente reproduce el mismo `ytId` desde su propia red, pero sin un reloj compartido los clientes acumulan drift de 1-3s. La V1 ([[use-jam-sync]]) corregía con un seek duro al superar 2s, audible y molesto. Sincronización exacta requeriría WebRTC o un servidor de timing.
- **Decisión**: **no** introducir WebRTC. Mantener el broadcast via Supabase Realtime Postgres CDC y mejorar la corrección de drift en el guest con tres niveles:
  - `drift >= 1.5s` → seek duro (inevitable, audible).
  - `0.5s <= drift < 1.5s` → compensación con `playbackRate` (0.98 / 1.02), inaudible.
  - `drift < 0.5s` → reset de rate a 1.0 (alineado).
  Para esto se añadió `setRate(rate)` a [[html-audio-backend]] y [[howler-backend]], más un evento `ritmiq:set-rate` que escucha [[use-player]] (paralelo a `ritmiq:seek`).
- **Consecuencias**: drift pequeño se corrige sin saltos audibles; solo drift grande hace seek. 0 KB extra (sin libs). **No es sync de precisión** (no hay corrección de latencia de red ni reloj NTP); aceptable para uso personal/familiar. Si en el futuro se requiere sync sub-segundo (ej. fiesta con altavoces múltiples), evaluar WebRTC DataChannel con timestamp de host + offset estimado. El `playbackRate` con valores 0.98/1.02 puede ser audible para oídos entrenados → si molesta, estrechar a 0.99/1.01.

## ADR-020 — Glows pulsantes: animar solo `transform`/`opacity` (no `box-shadow`/`filter`)

- **Contexto**: varios elementos tenían un "glow pulsante" animando directamente `box-shadow` o `filter: drop-shadow` en un `@keyframes` infinito (StatsView llama de racha `ritmiq-streak-pulse`, PlaylistView FAB `fabGlow`, Library quick-play `quickPlayGlow`). En **Electron desktop (Linux)** se veían a tirones; en **PWA móvil** fluían bien. Causa: `box-shadow`/`filter` no se componen en GPU → fuerzan **repintado (paint) en cada frame**. El compositor del WebView móvil lo absorbe; Chromium/Electron en Linux no, de ahí el jank.
- **Decisión**: regla general — **nunca animar `box-shadow`/`filter` en bucle**. El glow se pinta **una sola vez** como `box-shadow` estático en un **pseudo-elemento** (`::after`) detrás del elemento, y el `@keyframes` anima solo su **`opacity` + `transform: scale()`** (ambas compuestas por GPU, sin paint). Se añade `will-change: transform, opacity`. Las animaciones tipo equalizer (`fabPulseBars`, `pulseBars`) ya usaban `transform: scaleY()` → no se tocaron.
- **Consecuencias**: el efecto visual es prácticamente idéntico pero suave en todas las plataformas. Coste: un pseudo-elemento extra por botón con glow. El guard de `prefers-reduced-motion` apaga el pseudo (`animation:none; opacity:0`). De paso se corrigieron dos bugs de sintaxis CSS con doble paréntesis (`var(--color-accent-hover))` en PlaylistView y `drop-shadow(...))` en `App.module.css`). **Pendiente (segundo pase opcional)**: los glows de los modales de hito (`sparkGlowBreath`, `fanfareGlowPulse`, `dailyGlowBreath`, `hoursGlowBreath`) tienen el mismo patrón pero aparecen rara vez; se dejaron para después.

## ADR-021 — Actualización de la PWA: `prompt` + auto-check 24h (no `autoUpdate`)

- **Contexto**: con `registerType: 'autoUpdate'` y el `registerSW` default, la PWA instalada no se actualizaba de forma fiable (no comprobaba updates periódicamente ni avisaba). Los usuarios terminaban **reinstalando**, lo que **borra IndexedDB** → perdían las descargas (que viven en `ritmiq-local`, ver [[local-downloads]]).
- **Decisión**: cambiar a **`registerType: 'prompt'`** y registrar el SW manualmente con `virtual:pwa-register` desde `apps/pwa/src/pwa-update.js`. Flujo: `onNeedRefresh` → toast persistente "Actualizar" (el usuario decide, para no cortar la reproducción) → `updateSW(true)` (SKIP_WAITING + reload). Auto-check con `registration.update()` cada **24h** + en `visibilitychange` (throttle 24h en localStorage). Se activa `cleanupOutdatedCaches` (purga precaches viejos, NO IndexedDB). Versión/fecha del build inyectadas con Vite `define` (`__APP_VERSION__`/`__BUILD_DATE__`) y mostradas en [[AboutInfoView]].
- **Consecuencias**: la PWA se actualiza **sin reinstalar y sin perder descargas** (IndexedDB sobrevive a updates/reloads). **Desacople**: el store `pwa-update` vive en `@ritmiq/ui` y NO importa `virtual:pwa-register` (que solo existe con el plugin PWA); `apps/pwa` enlaza las funciones reales con `bindUpdater()`. Así el build de **Electron desktop** —sin el plugin— compila igual y la sección de actualizaciones simplemente no aparece. Requiere `workbox-window` como dep directa de `apps/pwa`. **Límite iOS**: Safari PWA comprueba updates de forma perezosa; el check en `visibilitychange` mitiga pero la activación puede no ser instantánea (aceptable: evita la reinstalación). Ver flujo [[Actualizaciones]].

## ADR-022 — Auth offline-first: no cerrar sesión por error de red

- **Contexto**: bug de pérdida de descargas reportado. En PWA, al reabrir la app **sin internet**, las canciones descargadas "desaparecían" y volvían al recuperar red. Causa raíz: `auth.init()` validaba la sesión cacheada con `supabase.auth.getUser()` (petición de red). Sin red, `getUser()` devuelve **error de red**, pero el código lo trataba igual que "usuario borrado" y hacía **`signOut()`** → `user: null` → `resetLibrary()` → `tracks: []` → el cruce de `useDownloadsStats` con la librería vacía daba **0 canciones**. Los blobs **nunca se borraron** de IndexedDB; era un cierre de sesión espurio. (Existía `getUser()` para detectar un `db reset` legítimo que borra `auth.users`.)
- **Decisión**: hacer la inicialización de auth **offline-first**:
  1. `auth.init()`: si `!navigator.onLine` o `getUser()` lanza/devuelve un **error de red**, **NO** hacer signOut — confiar en la sesión cacheada (`persistSession: true` ya la guarda en localStorage). Helper `isAuthError(error)` distingue auth real (401/403/422, "user not found", "jwt") de red ("Failed to fetch", "Load failed" iOS, AbortError). Solo el primero justifica `signOut`.
  2. `library.load()`: si no hay `userId` accesible, en PWA hidratar desde Dexie (`getCachedTracks` + `listLocalIds`) en vez de `set({ tracks: [] })`. Nunca vaciar la librería por falta de red.
  3. `useDownloadsStats`: si el store `tracks` está vacío pero hay blobs, cruzar contra `getCachedTracks` (Dexie) → las descargas se ven 100% offline.
  4. `requestPersistOnce()` (storage.persist) ahora se exporta y se llama **al login** (no solo al descargar) para reducir el riesgo de eviction del SO sobre IndexedDB.
- **Consecuencias**: reabrir la PWA offline mantiene la sesión y las descargas visibles/reproducibles. El caso legítimo de "usuario borrado" sigue cerrando sesión, pero **solo con red** y error de auth real. `isAuthError` es conservador (default = transitorio) para no volver a expulsar al usuario por un error ambiguo. Verificado con tabla de 8 casos (red vs auth). No se pudo automatizar el flujo completo offline+reabrir (requiere device); validación manual recomendada con DevTools en modo offline.

## ADR-023 — `subscribeWithSelector` en el player store (fix sync del Jam)

- **Contexto**: en un Jam, los guests no reproducían la misma canción que el host. Causa raíz: [[use-jam-sync]] (host) detecta cambios del player con `usePlayerStore.subscribe((s) => s.currentTrack?.id, (id) => hostBroadcast(...))` — la firma `subscribe(selector, listener)`. Esa firma **solo existe con el middleware `subscribeWithSelector`**; el store ([[player|store player]]) usaba `create()` puro. En **zustand 5**, el vanilla `subscribe` acepta únicamente `subscribe(listener)`: el primer argumento (el selector) se registró como listener (recibe `(state, prev)`) y el callback real de broadcast **nunca se ejecutó**. Resultado: el host nunca propagaba `current_track` ni `is_playing` → los guests no recibían nada. ([[use-presence]] tenía el mismo error latente.)
- **Decisión**: envolver el store con `subscribeWithSelector` (`create(subscribeWithSelector((set,get)=>({...})))`) en vez de reescribir los subscribes a la firma vanilla. Es aditivo, no cambia la API para los componentes (que usan el hook con selector, soportado nativamente) y arregla de paso `use-presence`.
- **Consecuencias**: `subscribe(selector, cb)` ahora dispara `cb` **solo** cuando el valor seleccionado cambia (verificado: cambio de posición no dispara, cambio de track sí, con el id correcto). El host del Jam propaga track/play/pausa y los guests sincronizan. Riesgo bajo: el middleware no afecta el resto del store. Verificación funcional con un test del store en Node (no e2e con 2 clientes Realtime).

## ADR-024 — Cola colaborativa del Jam (tabla `jam_queue`, modelo "host aprueba")

- **Contexto**: en un Jam no había forma de que los amigos propusieran qué sonar; tampoco se veía quién sugería qué. La RLS de [[jam_sessions]] UPDATE es solo-host, así que los guests no podían escribir la cola existente (`jam_sessions.queue`).
- **Decisión**:
  1. **Tabla nueva [[jam_queue]]** (no reusar `jam_sessions.queue`): `(id, session_id, suggested_by, track jsonb, position, played_at)`. RLS por-usuario (patrón [[jam_participants]]): participantes INSERT sus filas; host UPDATE (orden/played) y DELETE; el autor DELETE su sugerencia no reproducida. Evita la concurrencia frágil de pisar un array JSONB y permite identificar al sugeridor de forma robusta.
  2. **Modelo "host aprueba"**: las sugerencias son **propuestas**, no reproducción automática FIFO. El host reproduce con `playSuggestion` (marca `played_at` + `playNow` local → se propaga por [[use-jam-sync]]). Mantiene el modelo "host controla" ya establecido (ADR-019).
  3. **UI contextual en [[QueuePanel]]**: el mismo botón/panel de cola se transforma según `jam.mode` (cola local ↔ cola del Jam). Una sola entrada, sin panel nuevo. Cada fila lleva avatar + nombre del sugeridor (resuelto de `profiles`, cacheado en `profilesById`).
  4. **Guest sin controles de transporte**: mientras la jam está activa, el guest no puede play/pausa/seek/next/prev en el [[Player]] (el host manda); conserva volumen/letra/panel.
- **Consecuencias**: experiencia colaborativa sin romper el control del host ni el sync. El SELECT abierto de `jam_queue` (como las otras tablas jam) permite leer la cola conociendo el código — aceptable para uso familiar. Verificado: builds verdes + Playwright del panel jam (380px). Falta validación funcional con 2 cuentas reales (host+guest, Realtime).

### Refinamientos (Bloque 3.5)

- **Guest read-only central**: deshabilitar los botones del [[Player]]/[[NowPlaying]] no bastaba — MediaSession (lockscreen/auriculares), atajos de teclado y clics en listas seguían pudiendo cambiar `isPlaying`/`currentTrack`, y entre broadcasts del host (5s) un pause local quedaba sin revertir. Solución: un **guard central** en [[use-jam-sync]] que, en `mode==='guest'`, suscribe al player store y revierte al instante cualquier estado que no coincida con el del host. Enforcement en un solo punto, robusto ante cualquier vía de entrada.
- **Sync tolerante (anti-cortes)**: el guest sin la canción descargada va por detrás por buffering; el umbral de seek de 1.5s provocaba seeks duros en cadena (cortes). Recalibrado a "sync tolerante": seek duro solo con drift ≥ 4s y fuera de un periodo de gracia de 6s tras cambiar de track; el resto se corrige con `playbackRate` ±4%. Acepta 2-4s de desfase a cambio de reproducción fluida. Es lo realista sin streaming de audio real (cada cliente reproduce desde su propia red).
- **Sugerir auto-encola**: "Sugerir a la jam" inserta en `jam_queue` con `played_at=null` (pendiente) — es una propuesta para que el host la apruebe/reproduzca, nunca reproducción automática. Disponible en [[PlaylistView]] y [[NowPlaying]] (canción actual). Otras vistas de track no tienen menú propio todavía.

## ADR-025 — Invitaciones de Jam via Amigos (tabla `jam_invites` + edge functions + push)

- **Contexto**: para hacer el Jam más social se quiso invitar a un amigo desde la sección Amigos, con notificación de unirse; si acepta se une, si rechaza el host es avisado. No había tabla de invitaciones ni functions de jam (el jam era 100% client-side).
- **Decisión**:
  1. **Modelo "al invitar"**: el host ya creó la jam (es host); la invitación lleva el `code`. Reutiliza `createSession`/`joinSession` sin lógica server-side de creación atómica. Si nadie acepta, la jam vacía se limpia con el cron de 24h.
  2. **Tabla [[jam_invites]]** (calcada de `shared_items`): `sender/receiver/session_id/code/status`. RLS por-usuario (insert exige amistad `accepted`); Realtime.
  3. **Edge functions** [[send-jam-invite]] (valida amistad + host + dedupe + push) y [[respond-jam-invite]] (accept devuelve `code`; **reject** push al host — antes ningún flujo notificaba el rechazo). Consistente con `send-share`/`respond-friend-request`.
  4. **Recepción multi-canal**: toast accionable "Unirse" (app abierta, [[use-social-realtime]] 4º canal) + push (app cerrada) + tarjeta en la pestaña Solicitudes de [[FriendsView]]. El badge social suma las invitaciones pendientes.
  5. **UI**: botón "Invitar" en cada fila de amigo solo si el usuario es host de una jam activa.
- **Consecuencias**: flujo social completo reutilizando toda la infraestructura existente (friendships, push, realtime, badges). El SELECT de `jam_invites` está restringido a participantes (a diferencia de las otras tablas jam con SELECT abierto). El consumidor del `?openTab=`/`push-click` del SW sigue sin estar cableado en el cliente (deep-routing desde el click del push), pendiente como mejora. Verificado: builds verdes + Playwright (pestaña Solicitudes con invitaciones + botón Invitar en Amigos). Falta validación funcional con 2 cuentas reales (invitar → push/toast → aceptar/rechazar).

## ADR-026 — Jam: arranque coordinado por broadcast + avance FIFO automático

- **Contexto**: el sync del Jam (ADR-019/024) hacía que el guest **persiguiera** la posición del host con `seek` + `playbackRate`. Resultados malos reportados: (a) cortes constantes cuando el guest no tenía la canción descargada (buffering → drift → seeks en cadena); (b) la canción se **ralentizaba audiblemente** (rate ±4% baja el tono); (c) la cola del jam **no avanzaba sola** (el host tenía que tocar cada canción manualmente — `store.queue` del player no contenía las sugerencias de `jam_queue`).
- **Decisión**:
  1. **Transporte por Realtime Broadcast** (no CDC de `jam_sessions`): mensajes efímeros de baja latencia en el canal `jam:<id>` — `prepare`/`ready`/`start`/`control`. La tabla `jam_sessions` queda solo como snapshot persistente para quien entra a mitad.
  2. **Arranque coordinado**: el host pide `prepare {track}`; cada cliente carga sin sonar (`backend.prepareForSync`, espera `canplay`, posición 0) y responde `ready`; el host **espera a TODOS** (UI "Esperando a N…" + botón "Reproducir igualmente"; deja de esperar a quien sale de presencia) y emite `start {startInMs}` relativo (~300ms, robusto ante relojes desfasados). Todos arrancan desde 0 a la vez con `backend.playAfter`.
  3. **Sin corrección audible**: se **elimina `playbackRate`**. Como todos parten de 0 coordinados, la deriva es de décimas; no se hace seek salvo emergencia. Esto elimina la ralentización.
  4. **Avance automático FIFO**: al terminar la canción en modo jam, el **host** (solo él) toma la 1ª sugerencia pendiente de `jam_queue` (`played_at=null`, orden `position`) y la reproduce coordinada (`jamAdvance` → `coordinatedPlay`), **sin aprobación**. El tap manual (`playSuggestion`) queda como "saltar a esta". Si no hay pendientes, se detiene limpiamente.
  5. **Guest read-only**: se conserva el guard central (revertir pause/cambios locales por cualquier vía).
  6. **Indicador por participante**: `readyByUser` (loading/ready) → spinner/check junto a cada avatar; el host ve por quién espera.
- **Consecuencias**: reproducción fluida sin saltos ni cambio de tono; la fiesta fluye sola (FIFO). Coste: un breve momento de "preparando" al cambiar de canción mientras todos cargan (mitigado por la auto-descarga del guest, ADR-027, y el pre-prepare). Si un guest tiene mala red, el host puede forzar el arranque. Verificado: builds verdes + tests (espera-a-todos, force, FIFO, cola vacía) + Playwright (barra de espera + indicadores). Falta validación funcional con 2 cuentas reales (Realtime).

## ADR-027 — Auto-descarga efímera del audio en el guest del Jam (`jamCache`)

- **Contexto**: en una jam, el guest que no tiene la canción descargada la stremea desde su red → buffering → arranque lento. Aun con arranque coordinado (ADR-026), el `prepare` tarda más para ese guest.
- **Decisión**: el guest **cachea el audio localmente** en una tabla Dexie nueva **`jamCache`** (v4, indexada por `ytId`), separada de `audioBlobs` (descargas reales). Al preparar un track, si no vino ya de un blob local, se descarga en background por la URL ya resuelta (cache global/cloud) y se guarda. La próxima reproducción (re-entrar, saltar atrás) es **local sin buffering** — el cascade de resolución prefiere `getJamBlobUrl(ytId)`.
  - **TTL 1 hora** + **LRU ~10 pistas** (lo que se cumpla primero); barrido al arrancar la app. **No** se borra al salir de la jam: si el usuario vuelve dentro de la hora, ya está local.
  - **Promoción**: si el usuario pulsa "Descargar" una canción que está en `jamCache`, se **mueve el blob a `audioBlobs`** sin re-descargar (`promoteJamCacheToDownload`, instantáneo).
  - **Activado siempre** (blob ~3-5MB); no aparece en la vista Descargas ni en stats.
- **Consecuencias**: cambio de canción casi instantáneo tras la primera reproducción; el handshake "esperar a todos" es más rápido. Coste: uso de IndexedDB acotado por TTL+LRU. El blob baja por la misma fuente que ya usaba para reproducir (sin tráfico extra significativo). Verificado: builds verdes + test de la lógica TTL/LRU. Falta validación funcional en device.

## ADR-028 — Dos modos de Jam: Sincronizado y Altavoz

- **Contexto**: el Jam solo permitía que todos reprodujeran en sync (cada dispositivo suena). Se pidió un segundo modo "altavoz" donde **un solo dispositivo** reproduce (una bocina) y los demás son control remoto — caso de reunión con una sola bocina.
- **Decisión**: columna `jam_sessions.kind` (`'sync'` | `'speaker'`, default `'sync'`), elegida al crear (selector en [[JamModal]]).
  - **sync** (actual, ADR-026): arranque coordinado, todos reproducen.
  - **speaker**: el **host es el altavoz** (único que reproduce audio). Los invitados NO preparan ni reproducen (su player se mantiene en pausa). Ven qué suena vía broadcast `speaker-state` (track + posición + play, solo visual) y controlan con un **control remoto compartido**: `requestControl(action)` emite un broadcast `control{speaker:true}` que **solo el host (altavoz) ejecuta** sobre su player (cualquier participante puede play/pausa/next/prev). `coordinatedPlay` ramifica: en speaker reproduce directo en el host sin handshake de "ready".
  - El effect de carga del player permite reproducir al `host && kind==='speaker'`; bloquea a guests y a host en sync (lo controla el handshake).
- **Consecuencias**: una jam tipo bocina con control remoto colaborativo, reutilizando el canal broadcast existente. Las jams previas siguen en sync (default). El control compartido no escribe la tabla (va por broadcast), así que no se tocó RLS. El guest en speaker no oye nada en su dispositivo (esperado). Verificado: builds verdes + test de routing de control (host ejecuta, guest no reproduce) + Playwright (selector + control remoto). Falta validación con 2 cuentas reales.

## ADR-029 — Espejo offline reconciliado por usuario (fix "otra base de datos" en iOS PWA)

- **Contexto**: tras el fix offline-first (ADR-022), la PWA hidrataba la UI desde un espejo de la biblioteca en Dexie. Reporte iOS: "me muestra otra base de datos". Causas: (1) `cacheTracks` hacía `bulkPut` **sin reconciliar** — los tracks borrados en remoto vivían en el espejo para siempre (y con lista vacía hacía early-return conservando lo viejo); (2) `getCachedTracks` devolvía **todo** el espejo sin filtrar por usuario (mezcla de cuentas en el mismo dispositivo); (3) el logout no limpiaba Dexie. iOS suspende la PWA y arranca con red inestable → se veía el espejo stale y el pull no llegaba a corregirlo (ni podía: nunca borraba).
- **Decisión**:
  1. **`cacheTracks(tracks, userId)` = REPLACE por usuario**: transacción que borra las filas stale de ese `userId` y upsertea las actuales. Biblioteca vacía ⇒ espejo vacío.
  2. **`getCachedTracks(userId)`** filtra por el índice `userId`; la hidratación offline sin sesión usa **`meta.lastUserId`** (persistido en cada load con sesión).
  3. **Cambio de cuenta** (`userId !== lastUserId`): `clearMirrorForAccountSwitch` limpia el espejo (tracks/playlists/playlistTracks) y **borra las descargas huérfanas** de la cuenta anterior (inaccesibles desde la nueva). [[use-downloads-stats]] también filtra por owner.
- **Consecuencias**: el espejo converge con el remoto en cada pull — la "base vieja" desaparece sola al abrir con red una vez, sin que el usuario borre datos (borrar datos/cache manual habría eliminado también las descargas). Multi-cuenta en un dispositivo ya no mezcla bibliotecas; el costo es re-descargar si se alternan cuentas (decisión: huérfanas se borran). Verificado: 5 tests de lógica (reconcilia, vacía, aislamiento por user, filtro, switch) + builds verdes.

## ADR-030 — Selección múltiple de canciones + fix del scroll bajo headers sticky

### Parte A — Acciones de lote con un solo `set` + un toast agregado

- **Contexto**: se añadió selección múltiple de canciones en [[PlaylistView]] y en el filtro "Descargados" de [[Library]] (seleccionar varias o todas y operar en lote: reproducir, cola, favoritos, añadir a playlist, descargar/quitar descarga, quitar de playlist, eliminar de biblioteca). Las acciones del store eran **single-track**; iterar `addTrack`/`removeTrack`/`undownload` en un loop produciría **N toasts y N renders** (y, en `undownload`, **N recargas** de la biblioteca).
- **Decisión**:
  1. **Acciones plurales en los stores**: [[playlists]] gana `addTracks`/`removeTracks`/`toggleFavoriteMany`; [[library]] gana `removeMany`/`undownloadMany`. Cada una persiste en paralelo (absorbiendo 409 en add) pero hace **un único `set` de estado y emite un único toast agregado** (`N añadidas a X`). `undownloadMany` hace **un solo `load()`** al final.
  2. **Estado de selección con `Set` de IDs** + toggle inmutable (`new Set(prev)`), patrón ya usado en [[ShareToFriendModal]]. "Seleccionar todo" alterna `new Set(filtered)` ↔ `new Set()`.
  3. **dnd-kit desactivado en modo selección**: en [[PlaylistView]] se omiten `DndContext`/`SortableContext` (render plano) para no chocar con la gesticulación de tap; **toda la fila `<li>` es el área de toque** (hijos con `pointer-events: none`) — robusto en desktop y PWA móvil. Se quitó un `React.memo` inútil (las `actions` se recrean cada render).
  4. **[[SaveDialog]] multi-track**: acepta `tracks[]` (back-compat con `track`); checkbox **tri-estado** por playlist (todas/algunas/ninguna → `Check`/`Minus`/vacío).
- **Consecuencias**: feedback limpio (un toast por operación), menos renders y una sola recarga al quitar descargas; sin conflicto con el reordenamiento por drag. El indicador de descarga se pinta en **verde** durante la selección (mismo ícono `CheckCircle2`) para distinguir lo descargado. Verificado: builds PWA + desktop verdes.

### Parte B — Quitar `padding-top` del `.main` para que `position: sticky` funcione

- **Contexto**: en **desktop** (Electron), al scrollear la biblioteca, las canciones **asomaban por encima y por debajo** del header sticky de [[Library]] (avatar + título + chips + sortRow). Bug solo desktop.
- **Causa raíz** (tras descartar `will-change`): el contenedor de scroll `.main` (`App.module.css`) tenía `padding: var(--space-5)` (24px en los 4 lados). Con `position: sticky; top: 0`, el header se pega al **borde de padding** del scroll-port, no al físico → quedaban 24px arriba descubiertos por donde el contenido asomaba. Las "soluciones" previas (`margin-top` negativo, `::after`) no funcionaban porque el sticky se pegaba al sitio equivocado. (Contribuyente secundario: el `transform` transitorio de GSAP en `.viewSlot` durante la animación de entrada crea un containing block que rompe el sticky ~320ms; no se abordó aún.)
- **Decisión**: **eliminar el `padding-top` del `.main`** (`padding: 0 var(--space-5) var(--space-5)`). Así el borde del scroll-port coincide con el físico y `top: 0` pega el header arriba del todo, cubriendo con su fondo opaco. Compensaciones:
  1. **8 vistas** que dependían de ese padding reponen `padding-top: var(--space-5)` **solo en desktop** (`@media min-width:769px`): [[Home]], [[Downloads]], [[StatsView]], [[YtPlaylistView]], [[SearchView]], [[ArtistView]], [[AlbumView]], [[HistoryView]].
  2. **[[Library]]**: se eliminó la compensación negativa desktop, el `.stickyHeader` **duplicado** y el `::after`; el `sortRow` se movió **dentro** del `.stickyHeader` (también queda fijo). Conserva `padding-top: var(--safe-top)` para la safe-area en PWA.
  3. **[[PlaylistView]]**: el hero desktop pasa de `margin-top: -24px` a `0` (ya no hay padding que escapar); conserva el margen lateral negativo para el full-bleed.
  4. Sin cambios: [[SettingsView]] (ya tenía 12px propios), [[FriendsView]]/[[ProfileView]] (scroll interno con header propio). **Móvil intacto** (las ediciones van en media query desktop; el `.main` móvil mantiene su `padding-top` de safe-area).
- **Consecuencias**: el header sticky se comporta correctamente sin parches; el patrón queda como regla de arquitectura: **el scroll-port (`.main`) no lleva `padding-top`; cada vista repone su espaciado superior**. Verificado: builds verdes + validación visual desktop (biblioteca sin bleed, playlist hero pegado, vistas conservan su espaciado) + PWA sin regresión.

## ADR-031 — Servidor headless 24/7 + identidad JWT + caché primario

- **Contexto**: el "algoritmo" de búsqueda/descarga vivía solo en el desktop (Electron levantaba el LAN server). Queríamos un servidor casero 24/7 que no dependa de tener la app abierta, con cuentas propias de YouTube por usuario y control de acceso.
- **Decisión**:
  1. **Extraer la lógica a `@ritmiq/server-core`** host-aware (`setHost`), consumida por desktop y por `apps/server` (Node puro, Docker/systemd). Ver [[server-core]], [[apps-server]].
  2. **Identidad verificada con JWT de Supabase** (`auth-jwt.js`, ES256 vía JWKS sin secreto; HS256 legacy fallback). El `supabase_user_id` sale del `sub` del token, no del body → anti-suplantación. `/pair` exige login. Ver [[Autenticacion-y-JWT]].
  3. **Administración de dos niveles**: dueño (access-token) gestiona todo; sub-admin (JWT) solo sus dispositivos. Panel web `/admin` + CLI + desktop remoto. Cookies aportables desde el desktop. Ver [[Administracion-Dispositivos]].
  4. **Cookies propias por usuario**: cifradas (AES-256-GCM, `RITMIQ_COOKIES_KEY`); vía subida `cookies.txt`, login noVNC ([[Login-noVNC]]) o aporte del desktop.
  5. **Servidor como host primario** (modo `auto`): el cliente prioriza el servidor 24/7 (donde vive el caché) sobre el desktop. Modo `prefer-desktop` para lo contrario. Ver [[Multi-Endpoint-y-Seleccion-Host]].
- **Consecuencias**: uso 24/7 sin desktop; multi-cuenta seguro; caché centralizado en el servidor. Coste: nueva superficie de despliegue (Docker) y el túnel `ritmiq.org` movido al servidor. Verificado: tests JWT/devices + E2E Docker + smoke en prod.

## ADR-032 — Sacar yt-dlp del camino crítico (caché + prewarm)

- **Contexto**: buscar→sonar tardaba ~8s. Medido: search ~2.2s + resolve cold ~3.2s + túnel. El coste es **lanzar un proceso yt-dlp nuevo** por búsqueda/play (round-trips a YouTube). No es el runtime Deno ni el signature solving (medidos iguales). InnerTube directo por HTTP es 8x más rápido pero ya no da URLs usables (PO tokens).
- **Decisión** (Fases A-D): como no se puede reemplazar yt-dlp, se le saca del camino crítico:
  1. **Caché de búsqueda por query** en `/yt/search` (TTL 10min) → repetida ~0.001s.
  2. **Prewarm** de los primeros resultados; el top-1 con `&download=1` (descarga el m4a completo, play instantáneo permanente).
  3. **Concurrencia adaptativa** (`RITMIQ_YTDLP_CONCURRENCY`, cores/2 acotado 3-8) para prewarms en paralelo.
  4. **Fix** `resolveCached(dlOpts)`: el streaming usa las cookies del solicitante en cache-miss.
  5. **Warm-up del túnel** del servidor en `visibilitychange`.
  6. **Migración** del caché de archivos del desktop al servidor (`import-shared-cache.js`).
- **Consecuencias** (vía túnel): search cache HIT ~0.8s, play tras prewarm ~0.9s, archivo cacheado ~0.8s (dominado por el túnel, ya no por yt-dlp). Ver [[Cache-y-Rendimiento]].

## ADR-033 — Búsqueda persistente + paginación real ("Ver más")

- **Contexto**: al navegar fuera de la búsqueda y volver, se perdía el estado (tab/scroll); SearchView se remontaba (el `key` incluía la query). La sección "Canciones" mostraba solo 5 videos (límite Edge) y dedupe agresivo dejaba 2-3 visibles.
- **Decisión**:
  1. **`key` estable** `'search'` en `App.jsx` → no remonta entre queries ni al volver. Tab y scroll suben al store `search.js` (persisten). Botón X = limpiar búsqueda completa (única forma de borrarla). Ver [[SearchView]].
  2. **Más variedad**: Edge `type=all` 5→12 por tipo; tab dedicado carga max=30.
  3. **Paginación real** con continuation tokens de InnerTube (`search-youtube` extrae y reenvía el token); botón "Ver más" hace append con dedupe. Ver [[search-youtube]].
  4. Tab "Canciones" **no oculta duplicados**: los marca con badge ("En biblioteca"/"Conocida en Ritmiq").
- **Consecuencias**: buscar deja de ser estresante (persiste, más resultados, "Ver más"). Verificado: 3 páginas → 57 videos únicos, 0 duplicados; builds verdes.

---

> Agregá nuevos ADRs aquí cuando tomes decisiones que afecten la arquitectura.

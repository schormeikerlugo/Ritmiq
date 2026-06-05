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

---

> Agregá nuevos ADRs aquí cuando tomes decisiones que afecten la arquitectura.

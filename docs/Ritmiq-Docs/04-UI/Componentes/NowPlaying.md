---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/NowPlaying/NowPlaying.jsx
tags: [componente, now-playing, fullscreen, ios, mediasession, bpm, lyrics, visualizer]
---

# `NowPlaying`

> Vista fullscreen "Now Playing" estilo Spotify. Slide-up/down animado, fondo gradiente del color dominante del cover, scrubber draggable, BPM pulse en el cover y wake lock de pantalla.

## Ubicación
`packages/ui/src/components/NowPlaying/NowPlaying.jsx:1` (460 líneas)

## Props
Sin props. Lee todo desde stores.

## Stores y hooks consumidos

| Fuente | Uso |
|---|---|
| [[player]] store | `currentTrack`, `isPlaying`, `positionSeconds`, `durationSeconds`, `shuffle`, `repeat`, `togglePlay/Shuffle`, `cycleRepeat`, `next`, `prev`, `patch`, `radioMode`, `startRadio`, `stopRadio` |
| [[view]] store | `nowPlayingOpen`, `closeNowPlaying`, `toggleQueue` |
| [[playlists]] store | `isFavorite`, `favoritesId`, `addTrack`, `toggleFavorite` |
| [[library]] store | `persistEphemeral` |
| [[social]] store | `profile` (para "Compartir con amigo") |
| [[bottom-sheet]] store | `open` (para "..." menu contextual) |
| [[use-wake-lock]] | `useWakeLock(open && isPlaying)` — pantalla encendida mientras view activa |
| [[use-bpm-pulse]] | `useBpmPulse(getSharedBackend(), open)` — cover pulsante |
| [[dominant-color]] | `getDominantColor(coverUrl)` → fondo gradiente |
| [[haptics]] | `hapticTap` en like y share |
| [[use-player]] | `getSharedBackend()` — acceso directo al backend para seek y analyser |

## Funcionalidades

### Scrubber draggable
```
onPointerDown → captura la posición
onPointerMove → actualiza positionDragging
onPointerUp   → emite 'ritmiq:seek' con la posición final
```
No usa `backend.seek()` directamente — usa el mismo evento custom que [[Player]].

### Fondo gradiente
`getDominantColor(coverUrl)` retorna `rgb(r,g,b)`. Se aplica como:
```css
background: linear-gradient(var(--dominant), var(--bg-0))
```
Si CORS falla → fallback al color de fondo base sin gradiente.

### Panel "..." contextual
Abre [[BottomSheet]] con opciones: Guardar en playlist, Copiar link, Ver artista, Información del track.

### Sub-componentes
- [[ArtistInfoPanel]] (sub-componente en la misma carpeta — bio + discografía del artista)
- [[SaveDialog]], [[ShareToFriendModal]], [[Icon]]

## Casos de borde

- **BPM pulse solo cuando `open`**: si NowPlaying está cerrado, el rAF del hook se detiene (`enabled=false`) → cero CPU.
- **Wake lock con `open && isPlaying`**: solo activo cuando el usuario está mirando el cover. Si pausa, se libera para no drenar batería.
- **`useMemo` del gradiente**: `getDominantColor` devuelve Promise, el color se actualiza en un `useEffect`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `useWakeLock(true)` siempre | Pantalla nunca se apaga aunque NowPlaying esté cerrado. |
| Quitar `enabled` en `useBpmPulse` | rAF activo aunque NowPlaying esté cerrado → CPU leak. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 2.5): cover gana keyframe `ritmiq-cover-breathing` que anima el `box-shadow` accent (intensidad 60→100%, 4s sine inOut) cuando `data-playing="true"`. Independiente del BPM pulse. Commit `ab1372f`.
- 2026-05-27 (Fase 4.2 + ajuste UX): añadido toggle de letras en el **footer** (icono `Music2`, antes en el header). Cuando `lyricsOpen=true`, [[LyricsPanel]] reemplaza a [[ArtistInfoPanel]] post-fold. `hasLowerPanel` sustituye a `hasArtistPanel` para mantener min-height del mainArea. Commits `555231e` + `1220428`.
- 2026-05-27 (Fase 4.5 + FIX): añadido toggle de visualizador en el footer (icono `Sparkles`). Nuevo handler `handleVisualizerToggle` que llama `backend.initGraphFromGesture()` sincrónicamente dentro del click → ver [[Decisiones-Tecnicas-ADR|ADR-015]]. [[Visualizer]] renderizado entre `.info` y `.scrubber`. Commits `5f7ec2e`, `ba887a2`, `08f2677`, `f79cefb`.
- 2026-05-29: `lyricsOpen` ya no es estado local; viene de [[view]] (`lyricsOpen` + `setLyricsOpen`) para compartirse con el botón de letra del [[Player]] en desktop. El toggle del footer ahora usa `setLyricsOpen(!lyricsOpen)`. `jamOpen` sigue local (entrada móvil via bottom-sheet); el Player usa el flag global `jamModalOpen` de [[jam]].
- 2026-05-29 (UX header): el botón `⋯` del header migró de un bottom-sheet manual (`openMoreMenu` + `MoreMenuBody`, que se mostraba como sheet incluso en desktop) a [[DropdownMenu]]. Ahora en **desktop** abre un dropdown anclado al botón (UX óptima) y en **PWA móvil** sigue siendo bottom-sheet — la elección la hace el propio DropdownMenu por plataforma. Items con `icon` como nodo `<Icon>` + separadores. Eliminados `MoreMenuBody`, `openSheet`, clases `.moreMenu`/`.moreItem`. `DropdownMenu` ganó props `triggerClassName`/`wrapClassName`; el wrap usa `display:contents` (`.headerMenuWrap`) para no romper el grid del header.

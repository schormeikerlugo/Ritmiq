---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/Player/Player.jsx
tags: [componente, player, miniplayer, desktop, mobile]
---

# `Player`

> Mini-player persistente (barra inferior en desktop / overlay en mobile). Muestra cover giratoria, título/artista, controles play/pause/prev/next, volumen, shuffle, repeat, favorito y acciones "guardar" y "compartir". Tap en cover/meta → abre [[NowPlaying]].

## Ubicación
`packages/ui/src/components/Player/Player.jsx:1` (252 líneas)

## Props
Sin props. Lee todo desde stores.

## Stores consumidos

| Store         | Campos leídos                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [[player]]    | `currentTrack`, `isPlaying`, `positionSeconds`, `durationSeconds`, `volume`, `shuffle`, `repeat`, `error`, `togglePlay`, `setVolume`, `toggleShuffle`, `cycleRepeat`, `next`, `prev` |
| [[library]]   | `tracks` (para saber si inLibrary), `persistEphemeral`                                                                                                                               |
| [[playlists]] | `toggleFavorite`, `isFavorite`, `favoritesId`, `addTrack`                                                                                                                            |
| [[view]]      | `openNowPlaying`                                                                                                                                                                     |

## Estado local

```js
const [saveOpen, setSaveOpen] = useState(false);   // abre SaveDialog
const [shareOpen, setShareOpen] = useState(false); // abre ShareToFriendModal
```

## Sub-componentes usados
- [[SaveDialog]] (modal de guardar en playlist)
- [[ShareToFriendModal]]
- [[Icon]]

## Comportamiento clave

- **Cover giratoria**: `data-spinning={isPlaying && !!coverUrl}` — CSS rotation animation.
- **Barra de progreso mini**: `<div style={{ width: \`${progress}%\` }}` en la parte superior.
- **Botón corazón (like)**: si el track es efímero, llama `persistEphemeral` antes de añadir a Favoritas. Con [[haptics#hapticTap]] en Android.
- **`data-empty={!currentTrack}`**: el CSS colapsa el player cuando no hay track (height: 0 en mobile).
- Seek: emite evento `window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }))` para que [[use-player]] lo procese sin acoplamiento directo.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar `e?.stopPropagation()` en botones | Click en botón corazón también abre NowPlaying. |
| `persistEphemeral` no actualiza `currentTrack` | Track efímero no refleja el ID real tras guardar → isFavorite siempre false. |
| Evento `ritmiq:seek` con nombre diferente | [[use-player]] no recibe el seek → barra de progreso no funciona. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 2.4): `barFill` ahora usa `linear-gradient(accent → accent+white 30% mix)` por default (antes solo en hover). Glow halo accent en hover/focus/scrubbing vía `box-shadow: 0 0 12px accent 60%`. `barThumb` gana ring halo en hover. Commit `7f3241c`.
- 2026-05-27 (Fase 3.4): modo compacto automático en viewports con `max-height: 720px` (laptops 13"). `--layout-player-h` baja de 88 a 60px; `.controls` cambia de flex column a row; timestamps ocultos; cover 56→40px. Commit `6c6ca11`.
- 2026-05-27 (commit `270da70`): mini-player cover **revertido a `<img>` directo** (no usa [[CoverArt]] primitive) para mantener selector `.cover img` que rige el `vinyl-spin` animation cuando `data-spinning=true`.
- 2026-05-29: en el bloque `.right` (visible solo en desktop) se añadieron dos botones de acceso rápido: **Letra** (icono `Music2`) → `onLyrics` (toggle in-situ si NowPlaying abierto, si no `openLyrics()` de [[view]]) y **Jam** (icono `Users`) → `openJamModal()` de [[jam|store jam]] (el [[JamModal]] se monta en [[App|App.jsx]]). En móvil `.right` está oculto; ahí Jam/Letra siguen en [[NowPlaying]].
- 2026-05-31 (**jam guest lock**): si `useJamStore.mode === 'guest'`, los controles de transporte
  (shuffle, anterior, play/pausa, siguiente, repeat y la barra de scrub) se **deshabilitan** —
  en una jam el host controla la reproducción y el guest no debe pelear con el sync. Se muestra
  un hint "El host controla la reproducción". El guest **sí** conserva volumen, letra y el panel
  de cola del jam ([[QueuePanel]]). Ver flujo [[Jam-Mode]].

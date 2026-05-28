# Fase 4 — Features diferenciadoras ✓

La fase mas ambiciosa hasta ahora. 9 features que llevan Ritmiq de
"reproductor solido" a "reproductor con caracter": letras sincronizadas,
crossfade perceptual, visualizer, EQ con curva, heatmap anual, wrapped
mensual, drag-and-drop a playlists, historial buscable.

10 commits atomicos. Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 4.1 | `feat(lyrics): edge function + store cliente` | `1375f40` | Infra lyrics (lrclib.net + cache 30d server + store cliente con LRC parser). |
| 4.2 | `feat(lyrics): panel de letras sincronizadas` | `555231e` | UI panel con auto-scroll, line highlight, seek por click. |
| 4.3 | `feat(crossfade): fade-out al final del track` | `1890ecf` | Crossfade perceptual completo: fade-out + fade-in compuestos. |
| 4.4 | `feat(eq): visualizacion SVG de la curva de respuesta` | `6b88414` | Curva combinada de 6 bandas con gradient accent y dots. |
| 4.5 | `feat(visualizer): canvas espectral en NowPlaying` | (4.5) | 48 barras logaritmicas en canvas con AnalyserNode reusado. |
| 4.6 | `feat(stats): heatmap GitHub-style` | (4.6) | 53x7 grid de actividad anual con percentile-based buckets. |
| 4.7 | `feat(stats): Wrapped mensual con auto-trigger` | (4.7) | Modal top tracks/artists/dia del mes anterior, una vez por mes. |
| 4.8 | `feat(library): drag tracks a Sidebar playlists` | `8a08302` | HTML5 drag native, sidebar items droppable con highlight visual. |
| 4.9 | `feat(history): vista buscable con filtros` | (4.9) | Nueva view con search + date range + artist filter. |

## Cambios por area

### Lyrics (4.1 + 4.2)
- Migracion SQL `lyrics_cache(cache_key, artist, title, duration_sec,
  payload, refreshed_at)` con RLS read autenticado.
- Edge function `lyrics` proxy a lrclib.net + cache server-side (30d
  found, 7d miss).
- Store `useLyricsStore` con `parseLrc()` interno que convierte LRC
  sincronizado a `[{ timeMs, text }]`.
- Panel UI con 5 modos visuales (loading, error, instrumental, not
  found, synced, plain). Binary search O(log n) para linea activa.
  Auto-scroll smooth via scrollIntoView. Click seek via CustomEvent
  `ritmiq:seek`.
- Toggle Music2 icon en header de NowPlaying con data-active accent.

### Crossfade (4.3)
- `useCrossfade` ahora compone DOS fades:
    * fade-IN al cambiar currentTrack (existente).
    * fade-OUT cuando positionSeconds entra en `dur - crossfadeSeconds`.
- Flag `fadeOutStartedRef` evita re-disparos.
- setInterval @ 30Hz resiste background throttling Electron (documentado
  en docstring extensa de la function).

### EQ visualization (4.4)
- `EqCurve.jsx`: SVG con eje X log-freq, Y dB clamped a sliders.
- 80 samples interpolados con suma de respuestas por banda:
    * peaking: gaussiana en log-freq.
    * lowshelf/highshelf: sigmoide.
- Aproximacion sin AudioContext \u2014 reactiva pero no biquad real.
- Gradient fill + dots en bandas.

### Visualizer (4.5)
- `Visualizer.jsx`: canvas 48 barras log-bin via getByteFrequencyData.
- AnalyserNode reusado del backend (compartido con useBpmPulse).
- Smoothing exponencial 0.5 entre frames.
- HiDPI scale para retina.
- Off por defecto (battery). Toggle en menu Mas opciones de NowPlaying.

### Stats: Heatmap + Wrapped (4.6 + 4.7)
- `ActivityHeatmap.jsx`: 53x7 grid SVG con buckets percentiles (P25/P50/
  P75) sobre cuentas positivas. Mes labels arriba, dia labels izquierda.
  Hover tooltip + leyenda Mas/Menos.
- `MonthlyWrapped.jsx` con `MonthlyWrappedAutoTrigger`: auto-abre 1x
  por mes despues del dia 2 si no esta flag `ritmiq.wrapped-seen-YYYY-MM`.
  Modal con top 3 tracks (CoverArt), top 3 artistas, dia mas activo.
  Title con gradient text accent.

### Drag & drop (4.8)
- HTML5 native drag (sin dnd-kit) para evitar conflicto con sortable
  existente en PlaylistView/QueuePanel.
- MIME type custom `application/x-ritmiq-track` distingue nuestros
  payloads de drops del SO.
- Library track rows: draggable=true + setData del rawId.
- Sidebar playlist items: onDragOver acepta solo nuestro MIME,
  onDragLeave con contains(relatedTarget) para no flicker, onDrop
  llama addTrack + toast.
- Visual: outline dashed accent + background accent 18% + translateX 2px.

### History view (4.9)
- Nueva ruta `history` en view store + goHistory().
- 3 filtros componibles: search, dateRange (today/week/month/year/all),
  artistFilter (select unique artists).
- Click en row \u2192 playNow con el filtered como cola.
- Boton "Ver historial completo" en StatsView header.

## Bundle impact

| Stage | Precache | Delta vs Fase 3 |
|---|---|---|
| Inicio Fase 4 | 2276 KiB | base |
| Tras 4.1 (lyrics infra) | 2276 KiB | 0 (store no importado) |
| Tras 4.2 (lyrics UI) | 2284 KiB | +8 KiB |
| Tras 4.3 (fade-out) | 2285 KiB | +0.5 KiB |
| Tras 4.4 (EQ curve) | 2287 KiB | +2 KiB |
| Tras 4.5 (visualizer) | 2289 KiB | +2 KiB |
| Tras 4.6 (heatmap) | 2295 KiB | +6 KiB |
| Tras 4.7 (wrapped) | 2302 KiB | +7 KiB |
| Tras 4.8 (drag) | 2303 KiB | +1 KiB |
| Tras 4.9 (history) | 2311 KiB | +8 KiB |
| **Total Fase 4** | **2311 KiB** | **+35 KiB vs 2276** |

35 KiB para 9 features visibles + diferenciadoras. Mejor ratio
funcionalidad/peso que Fase 1 (que pago 71 KiB solo por GSAP core).

## Deploys requeridos

```bash
supabase db push                          # crea lyrics_cache
supabase functions deploy lyrics          # backend de letras
```

Sin esto, el panel de letras siempre mostrara error "lyrics 404".

## Verificacion manual

1. **Lyrics (4.1+4.2)**: NowPlaying \u2192 boton Music2 en header \u2192 si la
   cancion esta en lrclib, ves la letra. Click en linea \u2192 seek.
2. **Crossfade (4.3)**: Settings \u2192 Crossfade 4s. Espera a que un track
   termine: oyes fade-out suave. El siguiente entra con fade-in
   simetrico. Net sensation: cruce continuo.
3. **EQ curve (4.4)**: Settings \u2192 Activar EQ \u2192 cambia presets:
   la curva SVG cambia visualmente.
4. **Visualizer (4.5)**: NowPlaying \u2192 menu Mas opciones \u2192 Mostrar
   visualizador. 48 barras reaccionan al audio.
5. **Heatmap (4.6)**: Stats \u2192 nueva seccion ActivityHeatmap entre cards
   y trofeos. Hover muestra count + fecha.
6. **Wrapped (4.7)**: borra `localStorage.ritmiq.wrapped-seen-<mes-anterior>`
   y `localStorage.clear()` no, solo esa key. Reload \u2192 modal aparece
   tras 2s.
7. **Drag & drop (4.8)**: desde Biblioteca, drag un track row sobre
   un playlist item del Sidebar. Highlight accent dashed. Drop \u2192
   toast confirmacion.
8. **History (4.9)**: Stats \u2192 boton "Ver historial completo". Search +
   filtros funcionan compuestos.

## Siguiente fase

**Fase 5 \u2014 Recomendaciones backend (3h+)**:
  5.1 edge function enrich-tags (artist_tags cache).
  5.2 Home filas "Mix por genero real".
  5.3 Daily Mix pg_cron 4am.
  5.4 heuristica hora del dia.

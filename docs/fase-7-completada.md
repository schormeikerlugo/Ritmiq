# Fase 7 — Performance / técnica ✓

Bundle inicial reducido un 13% raw / 11% gzip respecto a Fase 5. Service
worker amplía cobertura de cache a covers de YouTube y Last.fm.
Container queries permiten que las cards del Home respondan al ancho
del main panel (no del viewport). Suite Playwright E2E skeleton para
validar boot + code-splitting en futuras regresiones.

6 commits atómicos (5 features + 1 doc). Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 7.1 | `perf(bundle): code-splitting por ruta con React.lazy` | `8cfe9c1` | 10 chunks lazy (Settings, Stats, Friends, Artist, Album, etc.). |
| 7.2 | `perf(bundle): split Auth + Onboarding + ResetPassword` | `2df884c` | 3 chunks lazy más para vistas que el user logueado nunca ve. |
| 7.3 | `perf(sw): runtime cache de covers YT + Last.fm` | `f90a241` | 2 reglas CacheFirst nuevas para `i.ytimg.com` y `lastfm.freetls.fastly.net`. |
| 7.4 | `perf(home): HomeRow + RowSkeleton a container queries` | `fcde0c9` | Cards encogen al ancho del main panel, no del viewport. |
| 7.5 | `test(e2e): Playwright smoke tests + skeleton de suite` | `a403b2a` | 2 smoke tests + roadmap V2 documentado. |

## Bundle impact total (vs Fase 5)

| Métrica | Antes Fase 7 | Después Fase 7 | Delta |
|---|---|---|---|
| Bundle inicial raw | 1,123 KB | 931 KB | **-192 KB (-17%)** |
| Bundle inicial gzipped | 323 KB | 287 KB | **-36 KB (-11%)** |
| Chunks lazy generados | 1 (ShortcutsHelp) | 13 | +12 |
| Peso total lazy (raw) | 1 KB | ~144 KB | +143 KB no descargados al boot |

## Detalle de chunks lazy

| Chunk | Raw | Gzip | Cuándo se descarga |
|---|---|---|---|
| `SettingsView` | 72 KB | 22.7 KB | User abre Ajustes |
| `FriendsView` | 12 KB | 4.0 KB | User abre Amigos |
| `AuthScreen` | 10.8 KB | 3.8 KB | Logout o primer ingreso |
| `StatsView` | 10 KB | 3.7 KB | User abre Stats |
| `YtPlaylistView` | 6.6 KB | 2.9 KB | Click playlist YT desde Search |
| `ArtistView` | 6.2 KB | 2.5 KB | User navega a un artista |
| `AlbumView` | 5.3 KB | 2.0 KB | User navega a un álbum |
| `MonthlyWrapped` | 5.0 KB | 1.9 KB | 1 vez al mes (auto-trigger) |
| `ProfileView` | 5.0 KB | 1.7 KB | User abre perfil de amigo |
| `HistoryView` | 4.3 KB | 1.5 KB | User abre historial |
| `Onboarding` | 3.0 KB | 1.5 KB | 1 vez por device |
| `ResetPasswordView` | 3.0 KB | 1.5 KB | Solo si llega vía link recovery |
| `ShortcutsHelp` | 1.1 KB | 0.5 KB | User pulsa `?` |

## Cambios por área

### Code-splitting (7.1 + 7.2)
- `App.jsx`: imports estáticos → `lazy(() => import(...).then(m => ({ default: m.X })))` por named exports.
- `<Suspense fallback={<TrackRowSkeleton count={6}/>}>` para vistas que requieren skeleton durante descarga.
- `<Suspense fallback={null}>` para componentes "invisibles condicionales" (Auth, Onboarding, MonthlyWrapped — el splash ya cubre el primer paint o el componente decide si renderizar).

### SW cache de covers (7.3)
- `vite.config.js` runtimeCaching:
  - `ritmiq-yt-covers`: CacheFirst para `i*.ytimg.com`, LRU 1000/30d.
  - `ritmiq-artist-covers`: CacheFirst para `lastfm.freetls.fastly.net`, LRU 300/30d.
  - `cacheableResponse: { statuses: [0, 200] }` para aceptar respuestas opaque (cross-origin sin CORS).
- Imágenes visibles offline + reduce ancho de banda en re-scroll.

### Container queries (7.4)
- `HomeRow.module.css` y `RowSkeleton.module.css`:
  - `.row` recibe `container-type: inline-size` + `container-name`.
  - `@media (max-width: 640px)` → `@container <name> (max-width: 640px)`.
- Beneficio: queue panel abierto en desktop → main panel ~340px menor → cards encogen sin un media query nuevo.
- Soporte: Chrome 105+ (Electron 33 ✅), Safari 16+, Firefox 110+.

### E2E tests (7.5)
- `playwright.config.js`: testDir `e2e/`, auto-arranca `vite preview --port 4173`, Chromium only V1.
- `e2e/smoke.spec.js`:
  - Test 1: app bootea + AuthScreen visible + cero errores fatales + cero 4xx/5xx en assets.
  - Test 2: SettingsView chunk NO se descarga en el boot (valida code-splitting).
- `e2e/README.md`: plan V2 con Auth/Play/Share flows + estrategia de seed user.
- `package.json`: scripts `test:e2e` y `test:e2e:headed`.

## Deploys / setup adicional

### Para correr los E2E tests
```bash
cd apps/pwa
pnpm run build                          # genera dist/ (requisito)
pnpm exec playwright install chromium   # primera vez (~300 MB)
pnpm run test:e2e                       # corre los smoke tests
```

### Sin deploys backend
La Fase 7 no toca Supabase ni edge functions. Todo es cliente.

## Verificación manual

### 7.1 + 7.2 (code-splitting)
1. DevTools → Network → reload con cache deshabilitado.
2. Boot: solo se descarga `index-*.js` (~931 KB).
3. Navegar a Ajustes → request nuevo `SettingsView-*.js` (~72 KB).
4. Volver a Ajustes en la misma sesión → no se re-descarga (cache).

### 7.3 (SW cache)
1. Boot con SW activo + reproducir un track de YouTube.
2. DevTools → Application → Cache Storage → debe aparecer `ritmiq-yt-covers` con el thumbnail.
3. Reload con `Offline` → el cover sigue visible.

### 7.4 (container queries)
1. Desktop con ventana > 1200px → cards Home 180px.
2. Abrir queue panel (toggle) → main panel se reduce → cards 150px (fluyen automáticamente).
3. Cerrar queue → cards vuelven a 180px.

### 7.5 (Playwright)
1. `cd apps/pwa && pnpm run build && pnpm exec playwright install chromium`.
2. `pnpm run test:e2e` → ambos tests deben pasar.
3. Headless por default; `pnpm run test:e2e:headed` para ver el browser.

## Limitaciones conocidas

- **Tests V2 pendientes**: signup, login, play, share. Requieren seed user en Supabase o mocks MSW. Documentado en `e2e/README.md`.
- **Container queries no tienen fallback**: browsers viejos (~1% del tráfico) ven cards en 180px siempre. Degradación gradual aceptable.
- **Onboarding lazy con fallback null**: si la red está muy lenta y el componente decide renderizar al primer mount, el user puede ver un flash blanco de < 200ms. Aceptable.
- **El smoke test del SW no falla** si el SW no se registra (warning solo) — porque `vite preview` no siempre registra el SW correctamente. Solo en build deploy real.

## Estado global del proyecto

- ✓ Fase 0 (5 commits) — Deuda comprometida
- ✓ Fase 1 (5 commits) — Sistema motion
- ✓ Fase 2 (6 commits) — Quick wins visuales
- ✓ Fase 3 (5 commits) — Sistematizar
- ✓ Fase 4 (9 commits) — Features diferenciadoras
- ✓ Fase 5 (4 commits) — Recomendaciones backend
- ✓ Fase 7 (5 commits) — Performance

## Siguiente

**Fase 6 (OPCIONAL — diferida)**:
- 6.1 Recs fuente YouTube Music Innertube (4h)
- 6.2 Scoring híbrido (2h)
- 6.3 Spotify Web API OAuth opcional (8h)

**Fase 8 (OPCIONAL — diferida)**:
- 8.1 Protocolo sync Realtime (6h)
- 8.2 UI invitar + unirse jam (4h)
- 8.3 Cola colaborativa (4h)

**Documentación del vault Obsidian**: pendiente actualización con Fase 5 + Fase 7 (5+1 notas nuevas, 2+3 actualizadas, 1+1 ADR).

**Deuda menor**:
- Token Supabase expuesto en chat (rotar desde dashboard).
- `chunkSizeWarningLimit` se puede bajar a 1000 (bundle ahora < 1MB).
- `RECOMMENDATIONS.md` y `share-deeplink-roadmap.md` need cleanup.
- `supabase/functions/_shared/` extraer `lfm`, `TAG_BLACKLIST` (DRY).

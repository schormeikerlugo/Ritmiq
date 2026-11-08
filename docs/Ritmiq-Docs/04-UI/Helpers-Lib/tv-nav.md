---
tipo: helper
capa: ui
plataforma: android-tv
estado: estable
ultima-revision: 2026-11-04
archivo: packages/ui/src/lib/tv-nav.js
tags:
  - helper
  - tv
  - mando
  - accesibilidad
  - navegacion
---

# `tv-nav.js` — navegación con el mando

> Solo en la app de Google TV (`VITE_TARGET=tv` → `IS_TV`, marca `<html data-tv>`). En PWA/escritorio es un no-op.

## Botones del mando (onn.)
| Botón | Acción |
|---|---|
| Flechas | Navegación espacial (`keydown` en captura): candidato más cercano en la dirección (distancia en el eje + 2× desvío lateral); ↑/↓ centran el elemento, ←/→ `nearest`. Sin foco → `focusMain()`. Con `role=dialog` abierto, solo dentro de la ventana. |
| OK | Nativo en botones/enlaces; en `role=button` sin activación nativa → `click()` (o el botón interior). Con una ventana abierta y el foco fuera (p. ej. tras cambiar de paso), flecha/OK van al **botón principal** (`data-primary`/`autofocus`, texto Continuar/Siguiente/Listo…, o el último) y OK lo pulsa. En un campo de texto, ver abajo. |
| Atrás | `MainActivity` → `window.__ritmiqTvBack()` (App.jsx): ventana abierta (Escape sintético) → salir del campo de texto → overlay/`goBack` (`edgeBackAction`) → Inicio → doble pulsación ("Pulsa Atrás otra vez") → `'exit'` = `moveTaskToBack` (la música sigue). |
| Canal ^ / v | `MainActivity.dispatchKeyEvent` → `window.__ritmiqTvKey('next'\|'prev')`. También `MEDIA_NEXT/PREVIOUS/PLAY_PAUSE`. |
| Volumen, silencio, inicio, etc. | Sistema. |

Candidatos: elementos enfocables visibles **sin controles dentro** (las filas arrastrables `role=button` se saltan y se va directo a su botón; el arrastre está desactivado en TV), salvo `<button>`/`<a>` nativos, que siempre cuentan; lo que tengan dentro con `tabindex=-1` (el «reproducir rápido» de las portadas en Biblioteca, menú e Inicio) se ignora. Puntuación: vertical = 2×eje + lateral, horizontal = eje + 2×lateral. Zonas (`main` / cada `aside` / resto): en vertical se penaliza cambiar de zona; en horizontal gana lo de la misma zona y fila si existe (banda siguiente del EQ antes que el reproductor), y si no se cruza (← desde el contenido → menú).

Campos de texto: al seleccionarlos con flechas reciben `inputmode=none` (no abre el teclado); la WebView se queda el OK sin pasarlo a la página, así que `MainActivity` al soltar OK llama `window.__ritmiqTvOk()` y si devuelve `'kb'` muestra el teclado (`showSoftInput`). ←/→ mueven el cursor salvo en los extremos; ↑/↓ salen. Sliders horizontales (barra de tiempo, Reproduciendo, crossfade): **se activan con OK** (`data-tv-engaged`, borde blanco + halo); sin activar, las flechas pasan de largo; activados, ←/→ los ajustan y OK/Atrás/↑/↓ los sueltan (`releaseSlider`, Atrás lo llama primero). Aviso "Pulsa OK para mover la barra" 2 veces en total; verticales (`data-tv-axis="vertical"`, bandas del EQ): ↑/↓ ±1 dB y ←/→ cambian de banda. `use-shortcuts.js` ignora las flechas en TV (antes ↑/↓ = volumen, ←/→ = canción).

## Zonas y capa de zonas (2026-11-08)
La pantalla se divide en zonas (`data-tv-zone` en `App.jsx`): **menu** (menú lateral), **content** (buscador + página), **queue** (cola, si está abierta) y **player** (barra inferior). Las flechas **no salen de la zona**; si no hay nada en esa dirección dentro de la zona se avisa (hasta 3 veces en total) "Pulsa Atrás para cambiar de zona".

- **Capa de zonas** (`openZoneLayer`, componente `TvZoneLayer`): recuadra la zona elegida y oscurece el resto (sin nombres; el recuadro basta). ← Menú · → Contenido/Cola · ↓ Reproductor · ↑ Contenido · OK entra.
- **Memoria por zona** (`lastFocus`, vía `focusin`): al entrar en una zona el foco vuelve al último elemento usado; si no, Contenido → `focusMain()` (salta cabeceras con `data-tv-skip-initial`), Reproductor → play/pausa, Menú → sección activa.
- **Menú compacto**: columna de 72 px con iconos y miniaturas; con el foco en el menú (`html[data-tv-zone=menu]`) se despliega a 260 px **por encima** del contenido. OK en una sección → el foco pasa al contenido.
- **Atrás** (`App.jsx` `tvOnBack`): capa abierta → Inicio (la capa sigue) → en Inicio doble pulsación para salir · ventana → se cierra · campo de texto → se sale · Reproduciendo/cola/Jam → se cierran · en Contenido de una sub‑página (historial, o subvista de Ajustes) → atrás · en página principal, o desde menú/reproductor → abre la capa.
- En la TV `goPlaylist` guarda historial (Atrás desde una playlist vuelve a donde estabas).
- Arranque: foco dentro de Contenido.

## Tamaño
`apps/tv/index.html` `<meta viewport width=1280>` + `MainActivity` `setUseWideViewPort/LoadWithOverviewMode`: maquetación 1280×720 escalada a 1920×1080 (antes 960×540 por densidad 2×). CSS `html[data-tv]`: foco con borde de acento hacia dentro + tinte, menú lateral 200 px, portada de playlist 150 px, saludo de Inicio 40 px, sin pista "Ctrl K".

## Verificación (onn., por ADB)
Flechas por Inicio/playlist, OK reproduce, Canal ^ siguiente, buscador alcanzable con ↑, Atrás: Ajustes → Inicio → aviso → sale. Depurar foco: `adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>` + `Runtime.evaluate(document.activeElement)`.

## Notas / Changelog
- 2026-11-08 (c): con animaciones completas la lista "brincaba" al bajar rápido. Causas: (1) scroll suave reiniciado en cada pulsación → `tvFocus` usa `behavior: 'instant'` si la anterior fue hace < 600 ms; (2) `content-visibility: auto` con altura estimada menor que la real en la TV (56 vs 72/61 px) → desactivado en filas de Biblioteca y playlists en TV; (3) al cambiar de página `main.scrollTop = 0` se ANIMABA por el `scroll-behavior: smooth` del CSS → `scrollTo({ behavior: 'instant' })` (App.jsx y SearchView, también PWA/escritorio). Medido en el onn.: 0 retrocesos de scroll al bajar 20 veces.
- 2026-11-08 (b): capa sin nombres; barras horizontales se activan con OK.
- 2026-11-08: zonas estrictas, capa de zonas, memoria por zona, menú compacto y nuevo Atrás (ADR-045).
- 2026-11-05 (b): `setTvKeyInterceptor(fn)` — consume teclas antes de la navegación (reposo de [[TvNowPlaying]]).
- 2026-11-05: la Biblioteca no se podía recorrer (las filas son botones con un «reproducir rápido» dentro y se descartaban); ahora cuentan los botones nativos.
- 2026-11-04 (b): filas de canción (OK a la primera), botón principal de ventanas, teclado solo con OK, EQ vertical, zonas en la puntuación (↓ desde el hero de playlist iba al menú).
- 2026-11-04: creación (ADR-042).

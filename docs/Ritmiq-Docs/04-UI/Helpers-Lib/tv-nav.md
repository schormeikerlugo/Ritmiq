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
| OK | Nativo en botones/enlaces; en `role=button` sin activación nativa → `click()`. |
| Atrás | `MainActivity` → `window.__ritmiqTvBack()` (App.jsx): ventana abierta (Escape sintético) → salir del campo de texto → overlay/`goBack` (`edgeBackAction`) → Inicio → doble pulsación ("Pulsa Atrás otra vez") → `'exit'` = `moveTaskToBack` (la música sigue). |
| Canal ^ / v | `MainActivity.dispatchKeyEvent` → `window.__ritmiqTvKey('next'\|'prev')`. También `MEDIA_NEXT/PREVIOUS/PLAY_PAUSE`. |
| Volumen, silencio, inicio, etc. | Sistema. |

Campos de texto: ←/→ mueven el cursor salvo en los extremos; ↑/↓ salen. Sliders: ←/→ los ajusta el control. `use-shortcuts.js` ignora las flechas en TV (antes ↑/↓ = volumen, ←/→ = canción).

## Tamaño
`apps/tv/index.html` `<meta viewport width=1280>` + `MainActivity` `setUseWideViewPort/LoadWithOverviewMode`: maquetación 1280×720 escalada a 1920×1080 (antes 960×540 por densidad 2×). CSS `html[data-tv]`: foco con borde de acento hacia dentro + tinte, menú lateral 200 px, portada de playlist 150 px, saludo de Inicio 40 px, sin pista "Ctrl K".

## Verificación (onn., por ADB)
Flechas por Inicio/playlist, OK reproduce, Canal ^ siguiente, buscador alcanzable con ↑, Atrás: Ajustes → Inicio → aviso → sale. Depurar foco: `adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>` + `Runtime.evaluate(document.activeElement)`.

## Notas / Changelog
- 2026-11-04: creación (ADR-042).

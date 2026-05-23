---
tipo: componente
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/ShortcutsHelp/ShortcutsHelp.jsx
tags: [componente, shortcuts, teclado, ayuda, desktop]
---

# `ShortcutsHelp`

> Modal de ayuda con la lista de atajos de teclado disponibles en Desktop. Se abre con `?` (Shift+/) via [[use-shortcuts]].

## Ubicación
`packages/ui/src/components/ShortcutsHelp/ShortcutsHelp.jsx:1` (106 líneas)

## Props
Sin props (se renderiza sin props desde el BottomSheet que abre [[use-shortcuts]]).

## Contenido

Lista de todos los atajos documentados en [[use-shortcuts]]:

| Atajo | Acción |
|---|---|
| `Space` | Play / Pause |
| `→` | Siguiente |
| `←` | Anterior |
| `↑` / `↓` | Volumen ±5% |
| `M` | Mute |
| `Ctrl+K` o `/` | Buscar |
| `?` | Esta ayuda |

## Carga lazy

Importado con `import()` dinámico desde [[use-shortcuts]] para no incluirlo en el bundle inicial. Ver [[use-shortcuts#openShortcutsHelp]].

## Notas / Changelog
- 2026-05-22: nivel simple.

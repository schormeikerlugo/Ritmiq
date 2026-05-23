---
tipo: hook
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-shortcuts.js
tags: [hook, shortcuts, teclado, desktop]
---

# `useGlobalShortcuts()`

> Atajos de teclado globales del Desktop. Se monta una vez en App. Cubre play/pause, next/prev, volumen, mute y búsqueda.

## Ubicación
`packages/ui/src/lib/use-shortcuts.js:1` (170 líneas)

## Mapa de atajos

| Atajo | Acción |
|---|---|
| `Space` | Toggle play/pause |
| `→` | Siguiente pista |
| `←` | Pista anterior (o reinicia si pos > 3s) |
| `↑` | Volumen +5% |
| `↓` | Volumen -5% |
| `M` | Mute toggle (guarda volumen previo) |
| `Ctrl/Cmd+K` | Focus al input de búsqueda |
| `/` | Focus al input de búsqueda |
| `?` (Shift+/) | Abre modal de ayuda `ShortcutsHelp` |

## Guards (cuándo ignorar)

1. **Editable target**: input, textarea, select, `contentEditable` → ignorar para no interferir al escribir.
2. **BottomSheet abierto**: si hay sheets en el stack (`stack.length > 0`) → ignorar para que el sheet maneje sus interacciones.
3. **Modificadores inesperados**: `Ctrl+Shift+↑` no activa "volumen+" para no pisarse con atajos del navegador.

## Anatomía del código (snippet clave)

### Mute toggle con memoria de volumen
`packages/ui/src/lib/use-shortcuts.js:153-164`

```js
let volumeBeforeMute = null;  // módulo-level: persiste entre renders

if (k === 'm' || k === 'M') {
  const cur = store.volume ?? 0.8;
  if (cur > 0) {
    volumeBeforeMute = cur;
    store.setVolume(0);
  } else {
    store.setVolume(volumeBeforeMute ?? 0.5);
    volumeBeforeMute = null;
  }
}
```

**Por qué variable de módulo y no ref**: `volumeBeforeMute` debe persistir entre renders del componente y sobrevivir a desmontajes/remontajes (no es frecuente pero puede pasar). Un `useRef` se perdería si el componente se remonta.

### ShortcutsHelp con dynamic import
`packages/ui/src/lib/use-shortcuts.js:52-58`

```js
async function openShortcutsHelp() {
  const open = useBottomSheet.getState().open;
  const { ShortcutsHelp } = await import(
    '../components/ShortcutsHelp/ShortcutsHelp.jsx'
  );
  open({ title: 'Atajos de teclado', content: createElement(ShortcutsHelp) });
}
```

**Por qué dynamic import**: `ShortcutsHelp` es un componente raramente usado. No incluirlo en el bundle inicial reduce el JS del boot.

## Constante exportada

```js
export const SEARCH_INPUT_ID = 'ritmiq-search-input';
```

El `TopBar` debe poner este id en el input de búsqueda para que `Ctrl+K` y `/` lo encuentren con `getElementById`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar guard de BottomSheet | Espacio durante un sheet de confirmación dispara play/pause en background. |
| `volumeBeforeMute` como ref en lugar de módulo | Remontaje del componente resetea la memoria de volumen → mute → unmute da 0.5 en lugar del volumen original. |
| Quitar guard de `isFromEditable` | Escribir texto en un input activa atajos → comportamiento caótico. |
| Cambiar `SEARCH_INPUT_ID` | `Ctrl+K` no encuentra el input → no hace nada. |

## Notas / Changelog
- 2026-05-22: nivel medio.

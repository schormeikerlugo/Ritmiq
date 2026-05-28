---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/use-shortcuts-onboarding.js
tags: [hook, onboarding, shortcuts, accessibility, toast]
---

# `useShortcutsOnboarding(userId)`

> Muestra un toast informativo **una vez por device** cuando un usuario nuevo con teclado físico entra a Ritmiq, indicándole que `?` abre la lista de atajos.

## Ubicación
`packages/ui/src/lib/use-shortcuts-onboarding.js:1` (76 líneas)

## Por qué existe

Los shortcuts de [[use-shortcuts]] (`Ctrl/Cmd+K` search, `?` ayuda, `Space` play/pause, etc.) existían pero eran invisibles. Ningún usuario los descubría salvo por accidente. Este hook + el hint `⌘ K` en el [[TopBar]] cierran ese gap.

## Heurística de "teclado físico probable"

```js
function hasPhysicalKeyboardLikely() {
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const wideEnough = window.innerWidth >= 768;
  return finePointer && wideEnough;
}
```

| Plataforma | ¿Dispara? |
|---|---|
| Desktop Electron | ✅ |
| PWA en laptop | ✅ |
| Mobile Safari/Chrome | ❌ (pointer:coarse) |
| iPad con teclado externo | ⚠️ depende del browser; falso negativo aceptable |

## Trigger

`useEffect` con `userId` como dep:

1. Si `!userId` → no-op.
2. Si `!hasPhysicalKeyboardLikely()` → no-op.
3. Si `localStorage.getItem('ritmiq.shortcuts-seen') === '1'` → no-op.
4. `setTimeout` 4000ms (para no chocar con `DailyStreakToast` y `MilestoneToast` que se disparan al login).
5. Set flag en localStorage **antes** de mostrar el toast (idempotencia).
6. `toast.show({ message, icon: 'Sparkles', duration: 8000, action: { label: 'Ver', onClick: openShortcutsHelp } })`.

`openShortcutsHelp` reusa el mismo path del shortcut `?`: abre [[ShortcutsHelp]] dentro del [[BottomSheet]] vía dynamic import.

## Persistencia

| Clave localStorage | Valor | Vida |
|---|---|---|
| `ritmiq.shortcuts-seen` | `'1'` | Permanente hasta que el usuario limpie storage |

Una vez visto, **nunca** se vuelve a mostrar en ese device. Para reset: `localStorage.removeItem('ritmiq.shortcuts-seen')`.

## Dónde se monta

En [[App|App.jsx:414]] junto con `useGlobalShortcuts()`:

```js
useGlobalShortcuts();
useShortcutsOnboarding(user?.id ?? null);
```

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Quitar el `setTimeout(4s)` | Choque visual con DailyStreak/Milestone toasts |
| Cambiar la key de localStorage | Re-onboarding para todos los usuarios existentes |
| Bajar el ancho mínimo de 768 → 480 | Falsos positivos en mobile landscape |

## Casos de borde

- **User cierra el toast antes de tocar "Ver"**: el flag ya está marcado → no se vuelve a mostrar. Aceptable.
- **User cambia de device**: cada device tiene su propio localStorage → vuelve a aparecer.
- **Usuario con `prefers-reduced-motion`**: el toast aparece igual (es info, no animación decorativa).

## Changelog

- 2026-05-27 — Creado en Fase 3.3. Commit `57a0647`.

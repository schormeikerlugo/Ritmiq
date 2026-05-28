---
tipo: moc
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
tags: [moc, ui]
---

# MOC — UI Compartida

Ruta en repo: `packages/ui/src/`

Todo lo visual y de cliente vive aquí y se comparte entre Desktop y PWA.

## Componentes

```dataview
TABLE estado, ultima-revision
FROM "04-UI/Componentes"
WHERE tipo = "componente"
SORT file.name ASC
```

## Primitives

Componentes atómicos reutilizables (`packages/ui/src/components/primitives/`). Migración progresiva de patrones repetidos. Ver [[Decisiones-Tecnicas-ADR|ADR-009]] (`CoverArt`) y [[Decisiones-Tecnicas-ADR|ADR-010]] (`ListView`).

- [[CoverArt]] — cover con gradient hash placeholder. Reemplaza `cover ? <img/> : <fallback/>`.
- [[ListView]] — lista vertical con virtualización opt-in (sin react-window).

## Hooks

```dataview
TABLE estado, ultima-revision
FROM "04-UI/Hooks"
WHERE tipo = "hook"
SORT file.name ASC
```

## Helpers / Librería

```dataview
TABLE estado, ultima-revision
FROM "04-UI/Helpers-Lib"
WHERE tipo = "modulo"
SORT file.name ASC
```

## Stores (Zustand)

```dataview
TABLE estado, ultima-revision
FROM "04-UI/Stores-Zustand"
WHERE tipo = "store"
SORT file.name ASC
```

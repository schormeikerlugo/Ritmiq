---
tipo: convencion
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [convencion]
---

# Convenciones de Notas

## Naming

- **Componentes React**: PascalCase exacto al export. `Player.md`, `NowPlaying.md`.
- **Hooks**: kebab-case con prefijo `use-`. `use-player.md`.
- **Helpers / módulos**: kebab-case igual al archivo. `howler-backend.md`.
- **Stores**: nombre del slice. `player.md`, `library.md`.
- **Edge Functions**: nombre exacto de la carpeta. `resolve-stream.md`.
- **Tablas**: nombre exacto de la tabla. `profiles.md`, `friendships.md`.
- **Migraciones**: `YYYYMMDD-nombre.md` (mismo orden que el SQL).
- **Flujos**: `Nombre-Descriptivo.md` con PascalCase espaciado por guiones.

## Frontmatter — valores permitidos

| Campo | Valores |
|---|---|
| `tipo` | `componente`, `hook`, `modulo`, `store`, `edge-function`, `tabla`, `migracion`, `flujo`, `adr`, `moc`, `glosario`, `plantilla`, `convencion`, `indice` |
| `capa` | `ui`, `desktop-main`, `desktop-preload`, `desktop-renderer`, `pwa`, `core`, `db`, `api`, `yt`, `supabase`, `meta`, `flujo` |
| `plataforma` | `desktop`, `pwa`, `ambas`, `backend` |
| `estado` | `estable`, `beta`, `deprecado`, `wip` |
| `ultima-revision` | fecha ISO `YYYY-MM-DD` |
| `archivo` | ruta relativa al repo, sin prefijo. Ej: `packages/ui/src/lib/use-player.js` |
| `tags` | array. Categorías libres. |

## Tags recomendados (jerárquicos)

- `tipo/hook`, `tipo/componente`, `tipo/store`, `tipo/edge`, …
- `capa/ui`, `capa/desktop`, `capa/supabase`, …
- `dominio/player`, `dominio/library`, `dominio/social`, `dominio/sync`, `dominio/auth`, `dominio/downloads`.
- `estado/estable`, `estado/beta`, `estado/wip`.
- `plataforma/desktop`, `plataforma/pwa`.

## Wikilinks

- Siempre **shortest** (Obsidian resuelve por nombre único). Si hay colisión, usar ruta: `[[04-UI/Hooks/use-player|use-player]]`.
- Para anclar a sección: `[[Glosario#Track]]`.
- Para alias: `[[use-player|el hook del player]]`.

## Wikilinks a código fuente

Cuando referencies código del repo, usá la forma `ruta:línea` literal (no es un link real de Obsidian, pero permite saltar desde el IDE):

```
Definido en `packages/ui/src/lib/use-player.js:42`.
```

## Diagramas

- **Mermaid** se incrusta así:

  ````markdown
  ```mermaid
  sequenceDiagram
    UI->>Store: play(track)
    Store->>Backend: load(url)
  ```
  ````

- Cada nodo debería poder mapearse a una nota existente. Si no, faltan notas.

## Tamaño de notas

- Si una nota supera ~300 líneas, partila en subnotas y dejá la madre como índice con wikilinks.
- Si una nota tiene menos de 10 líneas útiles, fusionala o convertila en sección de otra.

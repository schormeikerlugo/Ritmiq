---
tipo: moc
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [moc, raiz]
---

# MOC — Ritmiq

> Mapa raíz de la documentación. **180 notas** cubren todo el código del repo.

## Submapas

- [[MOC - Desktop]] — 13 notas: Electron main, preload, renderer.
- [[MOC - PWA]] — 5 notas: bootstrap, manifest, Service Worker, push, splash iOS.
- [[MOC - UI Compartida]] — 97 notas: 39 componentes + 17 hooks + 25 helpers + 16 stores.
- [[MOC - Backend Supabase]] — 26 notas: 13 Edge Functions + 12 tablas + índice migraciones.
- [[MOC - Flujos]] — 9 flujos end-to-end con Mermaid.

## Arquitectura

- [[Vision-General]] — diagrama mermaid alto nivel.
- [[Monorepo-y-Workspaces]] — pnpm + Turbo.
- [[Variables-de-Entorno]].
- [[Build-y-Deploy]].
- [[Decisiones-Tecnicas-ADR]] — 7 ADRs.

## Capas técnicas

| Capa | Carpeta | Notas |
|---|---|---|
| Desktop main (Electron) | `02-Desktop/Main-Process/` | 11 |
| Desktop preload + renderer | `02-Desktop/Preload`+`Renderer/` | 2 |
| PWA (manifest, SW, splash) | `03-PWA/` | 5 |
| Core (player, queue, sync, audio-source, types) | `05-Core/` | 5 |
| DB (schema + adapters) | `06-DB/` | 4 |
| API cliente (Supabase + LAN discovery) | `07-API-Cliente/` | 2 |
| YT (yt-dlp, ffmpeg, error-translator) | `08-YT/` | 3 |
| UI Componentes | `04-UI/Componentes/` | 39 |
| UI Helpers Lib | `04-UI/Helpers-Lib/` | 25 |
| UI Hooks | `04-UI/Hooks/` | 17 |
| UI Stores Zustand | `04-UI/Stores-Zustand/` | 16 |
| Supabase Edge Functions | `09-Supabase-Backend/Edge-Functions/` | 13 |
| Supabase Tablas | `09-Supabase-Backend/Tablas/` | 12 |
| Flujos end-to-end | `10-Flujos/` | 9 |
| MOCs + meta | `00-Index/` + `01-Arquitectura/` + `99-Mantenimiento/` | 15 |

## Apoyo

- [[Glosario]] — términos del dominio.
- [[Convenciones-de-Notas]] — naming, frontmatter, wikilinks.
- [[Template-Funcion]] — plantilla canónica con matriz de niveles.
- [[Como-actualizar-esta-doc]] — workflow obligatorio.

## Estado global de la doc (Dataview)

```dataview
TABLE WITHOUT ID
  capa AS "Capa",
  length(rows) AS "Notas",
  length(filter(rows, (r) => r.estado = "estable")) AS "Estables",
  length(filter(rows, (r) => r.estado = "beta")) AS "Beta",
  length(filter(rows, (r) => r.estado = "wip")) AS "WIP",
  length(filter(rows, (r) => r.estado = "deprecado")) AS "Deprecadas"
FROM ""
WHERE capa AND tipo != "moc" AND tipo != "indice"
GROUP BY capa
SORT capa ASC
```

## Notas revisadas hace más de 30 días (auditar)

```dataview
TABLE ultima-revision AS "Revisión", capa AS "Capa", tipo AS "Tipo"
FROM ""
WHERE ultima-revision AND tipo != "moc"
  AND date(today) - date(ultima-revision) > dur(30 days)
SORT ultima-revision ASC
LIMIT 20
```

## Cómo navegar este vault

1. **Por flujo**: empezá en [[MOC - Flujos]] → elegí el flujo de interés → el diagrama Mermaid linkea a cada módulo.
2. **Por capa**: usá los MOCs de capa con queries Dataview que listan todas las notas de cada carpeta.
3. **Por grafo**: abrí Obsidian → vista Graph. Los wikilinks crean un grafo navegable de dependencias.
4. **Por archivo de código**: cada nota tiene `archivo:` en el frontmatter — buscá por ese campo para encontrar la documentación de un archivo concreto.

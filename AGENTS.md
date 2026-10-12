# Ritmiq — instrucciones para agentes

Reproductor de música personal: PWA (`apps/pwa`), Desktop Electron (`apps/desktop`), servidor headless 24/7 (`apps/server`), UI compartida (`packages/ui`) y backend Supabase (`supabase/`).

## Documentación (vault Obsidian)

La documentación técnica vive en `docs/Ritmiq-Docs/` (vault de Obsidian, ~260 notas) y está expuesta por el **MCP `ritmiq-docs`** (`@bitbonsai/mcpvault`). Úsalo como primera fuente antes de leer código a ciegas:

- `search_notes` para buscar por concepto, función, tabla o archivo (también busca en el frontmatter, p. ej. `archivo:`).
- `get_note_outline` + `read_note_lines` para leer solo la sección necesaria.
- `wiki_link` para resolver `[[Nota]]` a su ruta.
- `patch_note` / `update_frontmatter` para ediciones puntuales; `write_note` para notas nuevas.

> `~/Ritmiq-Docs` es una copia antigua (agosto 2026). No la uses ni la edites.
> El MCP `obsidian` apunta a otra bóveda personal (`~/Obsidian Vault`), no a Ritmiq.

Puntos de entrada: `00-Index/MOC - Ritmiq.md`, `01-Arquitectura/Decisiones-Tecnicas-ADR.md`, `10-Flujos/`.

### Al cambiar código, actualiza la doc en el mismo commit

Sigue `99-Mantenimiento/Como-actualizar-esta-doc.md` y `Convenciones-de-Notas.md`. En resumen:

1. Actualiza la nota del archivo tocado (búscala por `archivo:` en el frontmatter): firma, comportamiento, `ultima-revision` y una línea en **Notas / Changelog**.
2. Notas nuevas: frontmatter completo (`tipo`, `capa`, `plataforma`, `estado`, `ultima-revision`, `archivo`, `tags`) y enlace desde su MOC.
3. Decisiones de arquitectura o cambios de comportamiento visibles: ADR nuevo o adenda en `Decisiones-Tecnicas-ADR.md`.
4. Migraciones SQL: fila en `06-DB/Migraciones/indice.md` y nota de la tabla en `09-Supabase-Backend/Tablas/`.
5. No incluyas en commits `docs/Ritmiq-Docs/.obsidian/workspace.json` ni los `Sin título*.base/.canvas`.

## Idioma

Responde al usuario en español.

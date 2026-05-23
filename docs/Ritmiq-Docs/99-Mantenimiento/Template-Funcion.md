---
tipo: plantilla
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [plantilla]
---

# Template — Función / Componente / Módulo

> Copia el bloque de abajo en cada nota nueva. No alteres el frontmatter sin razón: las queries Dataview dependen de él.

## Matriz de niveles por tipo de nota

No todas las notas necesitan el mismo detalle. Aplicá este nivel según el tipo:

| Tipo de nota | Snippets | Diagrama mermaid | Performance | Matriz "qué rompe" | Casos de borde |
|---|---|---|---|---|---|
| Módulo crítico (ipc, lan-server, devices, cloudflared, player core) | 4–6 | sí | sí | 5–8 filas | sí |
| Módulo simple (db, env, access-token, ytdlp-path) | 1–2 | opcional | no | 2–4 filas | breve |
| Hook | 2–3 | si tiene side-effects no triviales | no | 3–5 filas | sí |
| Componente UI puro | 1 (props + render principal) | no | no | 2–3 filas | si tiene estados raros |
| Store Zustand | 2 (slice + acción crítica) | no | no | 3–5 filas | sí |
| Edge Function | 3–4 | sí (request/response) | sí (cold start, quota) | 4–6 filas | sí |
| Migración SQL | DDL completa comentada | no | no | impacto en queries existentes | sí |
| Flujo end-to-end | mínimo | **el centro de la nota** | n/a | n/a | n/a |

Si dudás del tipo, defaulteá a "módulo simple". Es preferible una nota corta y útil que una larga que nadie lee.

---

## Frontmatter obligatorio

```yaml
---
tipo: hook              # componente | hook | modulo | store | edge-function | tabla | migracion | flujo | adr
capa: ui                # ui | desktop-main | desktop-preload | desktop-renderer | pwa | core | db | api | yt | supabase | meta | flujo
plataforma: ambas       # desktop | pwa | ambas | backend
estado: estable         # estable | beta | deprecado | wip
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-player.js
tags: [hook, player]
---
```

## Cuerpo canónico

```markdown
# `nombre-de-la-unidad`

> Una sola línea: qué hace esto en términos del usuario o del sistema.

## Ubicación
`ruta/al/archivo.js:linea`

## Firma / Props / Schema
\`\`\`js
// Pegá la firma real con tipos JSDoc o TypeScript.
function nombre(args): RetornoTipado
\`\`\`

## Inputs
| Nombre | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `arg1` | `string` | sí | … |

## Outputs / Retorno
Descripción del valor de retorno, eventos emitidos o efectos visibles.

## Anatomía del código (snippets comentados)

> Sección **obligatoria** para módulos con lógica no trivial. Pegá los bloques realmente importantes del archivo (no copies todo el archivo) y comentá línea por línea las decisiones críticas.
>
> Cada bloque debe:
> - Tener un encabezado `### <título descriptivo>` que diga qué hace.
> - Citar el rango `archivo.js:NN-MM` debajo del título.
> - Usar fenced code block con el lenguaje correcto (` ```js `, ` ```jsx `, ` ```sql `).
> - Llevar comentarios `//` o `--` explicando el porqué, no el qué (el código ya dice qué).
> - Si hay decisión arquitectónica detrás → resaltarla en negrita.

### Ejemplo de estructura

\`\`\`markdown
### Idempotencia del pareo
`apps/desktop/main/devices.js:75-86`

\\\`\\\`\\\`js
const existing = db.prepare(
  "SELECT device_token, display_name FROM devices WHERE device_id = ? AND status = 'approved'"
).get(deviceId);
if (existing) {
  return { status: 'approved', deviceToken: existing.device_token, displayName: existing.display_name };
}
\\\`\\\`\\\`

**Por qué**: la PWA puede perder su `device_token` (storage limpiado, reinstalación con mismo `device_id`)
pero seguir teniendo `device_id`. Si re-pidiéramos pareo desde cero le mostraríamos PIN al usuario otra vez.
Devolver el token existente cierra el caso sin fricción.
\`\`\`

## Dependencias entrantes (quién la llama)
- [[Componente-A]]
- [[hook-B]]

## Dependencias salientes (qué usa)
- [[store-player]]
- [[howler-backend]]
- [[resolve-stream]] (Edge Function)

## Side-effects
- IPC: canal `xxx` (si aplica)
- Red: llama a `supabase.functions.invoke('yyy')`
- Disco: escribe en `~/.config/ritmiq/…`
- DOM/Eventos: emite `window.dispatchEvent(new CustomEvent(...))`
- Storage: lee/escribe `localStorage.key`

## Errores manejados
- `ERR_X`: causa → acción tomada.
- Timeout de red → reintento con backoff.

## Casos de borde y gotchas

Lista de comportamientos no obvios que el código maneja explícitamente:

- **ID drift**: …
- **Race condition X**: …
- **Cookies caducadas**: …

## Qué puede romper este cambio

Para futuras modificaciones, qué síntomas observables aparecerían si rompés cada contrato:

| Cambio | Síntoma |
|---|---|
| Cambiar firma de `foo()` | El renderer al invocar `library:download` recibirá `undefined` y la UI mostrará spinner infinito. |
| Eliminar el `INSERT OR REPLACE` | Pareo idempotente se rompe → usuarios ven PIN dos veces tras reinstall. |

## Estados internos (si aplica)
Para componentes y stores: enumerar `useState` / `set`.

## Ejemplo de uso
\`\`\`jsx
const { play, pause } = usePlayer()
play(track)
\`\`\`

## Tests
- `ruta/al/archivo.test.js` (si existe)

## Notas / Changelog
- 2026-05-22: creación de la nota.
```

## Reglas

1. **Una nota = una unidad de código**. Si un archivo exporta varias funciones públicas, decidí: o una nota por export, o una nota por archivo con secciones `##` por export. Sé consistente dentro de la misma carpeta.
2. **Wikilinks sin extensión**: `[[ipc]]` no `[[ipc.md]]`.
3. **`file_path:line_number` siempre actualizado**. Si la línea cambia, actualizar al hacer el cambio.
4. **Cambiaste el código → actualizá la nota en el mismo commit**. Ver [[Como-actualizar-esta-doc]].

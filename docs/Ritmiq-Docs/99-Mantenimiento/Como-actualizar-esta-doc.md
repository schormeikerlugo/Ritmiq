---
tipo: convencion
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [workflow, mantenimiento]
---

# Cómo actualizar esta documentación

> La doc solo sirve si refleja el código **vigente**. Cuando dejás de actualizarla, en una semana te miente.

## Regla de oro

> **Si modificás `X.js`, en el mismo cambio actualizás `Ritmiq-Docs/.../X.md`.**

No hay excepciones para:

- Cambios de firma (args, retorno, props).
- Cambios de side-effects (canal IPC nuevo, evento que ya no se emite, escritura en disco diferente).
- Cambios de dependencias (importa algo nuevo, o dejó de importar algo).
- Cambios de comportamiento observable por el usuario.

Excepciones razonables (no requieren actualizar la nota):

- Cambios puramente de formato (linter, indentación).
- Refactors internos que no cambian inputs/outputs/side-effects.

## Workflow recomendado

1. Abrí la nota de la función que vas a tocar.
2. Lee la sección **Dependencias entrantes** para saber qué podés romper.
3. Hacé el cambio en el código.
4. Actualizá:
   - Firma / Props.
   - `archivo:`linea en el frontmatter.
   - `ultima-revision` a la fecha de hoy.
   - Sección **Notas / Changelog**: una bullet con la fecha y el cambio.
   - Si cambió a quién llama o quién la llama, actualizar **ambas notas** (la propia y la del otro lado).

## Cómo crear una nota nueva

1. Copiá [[Template-Funcion]].
2. Pegala en la carpeta correcta (`04-UI/Hooks/`, `02-Desktop/Main-Process/`, etc.).
3. Renombrala según [[Convenciones-de-Notas]].
4. Rellená frontmatter completo.
5. Linkeala desde:
   - El MOC correspondiente (suele auto-aparecer vía Dataview, pero verificá).
   - Las notas de funciones que la llaman (sección Dependencias entrantes de ellas, salientes en la nueva).

## Cómo auditar

- Abrir [[MOC - Ritmiq]] → ver tabla de **notas revisadas hace más de 30 días**.
- Para cada una: leer el archivo real, comparar, actualizar o marcar `estado: deprecado` si ya no aplica.

## Cómo deprecar una nota

1. Cambiar `estado: deprecado` en frontmatter.
2. Agregar al inicio del cuerpo:
   ```
   > **DEPRECADO** desde YYYY-MM-DD. Reemplazado por [[nueva-nota]] porque <razón breve>.
   ```
3. No borrar la nota: deja el rastro para entender historia.

## Idea futura (opcional, no implementada)

Script `scripts/docs-audit.js` que:

- Lee `git diff HEAD~1..HEAD`.
- Para cada archivo de código modificado, busca su nota en `Ritmiq-Docs/` por `archivo:` en frontmatter.
- Si la nota no fue tocada en el mismo commit, falla el pre-push.

Eso convierte la regla de oro en obligatoria.

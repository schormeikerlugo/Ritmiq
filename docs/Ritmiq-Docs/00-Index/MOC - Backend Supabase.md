---
tipo: moc
capa: supabase
plataforma: ambas
estado: estable
ultima-revision: 2026-05-28
tags: [moc, supabase, backend]
---

# MOC — Backend Supabase

Ruta en repo: `supabase/`

## Edge Functions

```dataview
TABLE estado, ultima-revision
FROM "09-Supabase-Backend/Edge-Functions"
WHERE tipo = "edge-function"
SORT file.name ASC
```

## Tablas

```dataview
TABLE estado, ultima-revision
FROM "09-Supabase-Backend/Tablas"
WHERE tipo = "tabla"
SORT file.name ASC
```

## Migraciones

```dataview
TABLE estado, ultima-revision
FROM "06-DB/Migraciones"
WHERE tipo = "migracion"
SORT file.name ASC
```

## Cliente desde apps

- [[supabase|cliente packages/api]]
- [[supabase|helper UI]]

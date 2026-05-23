---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260510000000_tunnel_endpoints.sql
tags: [tabla, tunnel, cloudflare, lan]
---

# `tunnel_endpoints`

> URL pública del Cloudflare Tunnel publicada por el Desktop. La PWA del mismo usuario la suscribe via Realtime para auto-reconectarse cuando el Quick Tunnel cambia de URL.

## Schema

```sql
user_id        uuid PK → auth.users(id) ON DELETE CASCADE,
url            text NOT NULL,
source         text CHECK (source IN ('quick','named','custom')),
access_token   text,                 -- añadido en 20260511 (tunnel_token)
updated_at     timestamptz NOT NULL DEFAULT now()
```

## RLS

- SELECT: solo owner (no es público — contiene URL + token sensibles).
- UPDATE/INSERT/DELETE: solo owner.

## Realtime

La PWA suscribe cambios con filtro `user_id=eq.<userId>`. Ver [[tunnel-registry#subscribeTunnelUrl]].

## Por qué `access_token` aquí

iOS Safari/PWA puede evict localStorage tras ~7 días de inactividad. Sin guardar el `access_token` en Supabase, la PWA queda sin auth tras esa eviction. Persistir aquí permite rehidratar al próximo login.

## Cliente

- [[tunnel-registry]] → `publishTunnelUrl`, `clearTunnelUrl`, `subscribeTunnelUrl`.
- [[cloudflared|main/cloudflared]] (Desktop) → publica vía `publishTunnelUrl`.

## Notas / Changelog
- 2026-05-22: nivel simple.

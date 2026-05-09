#!/usr/bin/env bash
#
# Despliega todas las Edge Functions de Ritmiq a Supabase Cloud.
#
# Pre-requisitos:
#   1. Tener un access token de https://supabase.com/dashboard/account/tokens
#   2. Tener la DB password del proyecto cloud (Settings → Database → Database password)
#
# Uso:
#   ./scripts/deploy-cloud-functions.sh
#
# Idempotente: se puede correr múltiples veces.

set -euo pipefail

PROJECT_REF="gukzacuwcaqgkzchghcg"
SUPABASE_BIN="./node_modules/.bin/supabase"
FUNCTIONS=(resolve-stream search-youtube)

if [ ! -x "$SUPABASE_BIN" ]; then
  echo "Error: $SUPABASE_BIN no encontrado. Ejecuta 'pnpm install' primero."
  exit 1
fi

# 1) Login si hace falta
if ! "$SUPABASE_BIN" projects list >/dev/null 2>&1; then
  echo "→ Login en Supabase CLI..."
  echo "  Ve a https://supabase.com/dashboard/account/tokens"
  echo "  Crea un token y pégalo cuando lo pida."
  "$SUPABASE_BIN" login
fi

# 2) Link (idempotente — recrea el archivo .temp/project-ref si hace falta)
if ! grep -q "$PROJECT_REF" supabase/.temp/project-ref 2>/dev/null; then
  echo "→ Linkeando proyecto $PROJECT_REF..."
  "$SUPABASE_BIN" link --project-ref "$PROJECT_REF"
fi

# 3) Deploy de cada Edge Function
for fn in "${FUNCTIONS[@]}"; do
  echo "→ Deploy: $fn"
  "$SUPABASE_BIN" functions deploy "$fn" --no-verify-jwt
done

echo ""
echo "✓ Listo. Verifica con:"
echo "  curl 'https://${PROJECT_REF}.supabase.co/functions/v1/search-youtube?q=nirvana'"

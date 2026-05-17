#!/usr/bin/env bash
# Deploy de la Edge Function `sign-stream` + setea STREAM_SIGNING_SECRET.
# Requiere SUPABASE_ACCESS_TOKEN (Personal Access Token de tu cuenta) en env.
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx
#   ./scripts/deploy-sign-stream.sh

set -euo pipefail

PROJECT_REF="gukzacuwcaqgkzchghcg"
SUPABASE_BIN="node_modules/.pnpm/supabase@2.98.2/node_modules/supabase/bin/supabase"
SECRET=$(grep -E '^STREAM_SIGNING_SECRET=' supabase/.env | cut -d= -f2)

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN no seteado."
  echo "   Genera uno en https://supabase.com/dashboard/account/tokens"
  echo "   y luego:  export SUPABASE_ACCESS_TOKEN=sbp_..."
  exit 1
fi

if [ -z "$SECRET" ]; then
  echo "❌ STREAM_SIGNING_SECRET no encontrado en supabase/.env"
  exit 1
fi

echo "→ Seteando STREAM_SIGNING_SECRET en proyecto $PROJECT_REF..."
"$SUPABASE_BIN" secrets set --project-ref "$PROJECT_REF" "STREAM_SIGNING_SECRET=$SECRET"

echo "→ Deployando Edge Function sign-stream..."
"$SUPABASE_BIN" functions deploy sign-stream --project-ref "$PROJECT_REF"

echo "✓ Deploy completo. Prueba desde la PWA."

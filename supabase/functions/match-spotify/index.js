// Edge Function: matching Spotify → YouTube.
// Placeholder. Fase 5.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(() => new Response(JSON.stringify({ error: 'not_implemented' }), {
  status: 501,
  headers: { 'content-type': 'application/json' },
}));

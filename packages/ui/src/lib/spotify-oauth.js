/**
 * Spotify OAuth PKCE flow client-side (Fase 6.3).
 *
 * Estado: **infraestructura**. La UI todavia no expone un boton "Conectar
 * Spotify". Cuando se quiera activar:
 *   1. Registrar la app en https://developer.spotify.com/dashboard.
 *   2. Setear SPOTIFY_CLIENT_ID en Supabase secrets.
 *   3. Configurar el redirect_uri en Spotify dashboard:
 *        https://ritmiq.app/auth/spotify-callback
 *        http://localhost:5173/auth/spotify-callback (dev)
 *   4. Setear VITE_SPOTIFY_CLIENT_ID en .env del cliente.
 *   5. Anadir una pagina /auth/spotify-callback que reciba ?code= y llame
 *      a exchangeCodeForToken().
 *   6. UI en SettingsView que llame startSpotifyAuth().
 *
 * Spotify PKCE no requiere client_secret en el cliente (puro PKCE) o
 * permite client_secret server-side si esta presente (mas seguro).
 *
 * @module @ritmiq/ui/lib/spotify-oauth
 */
import { supabase } from './supabase.js';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SCOPES = [
  'user-top-read',                   // top artists / top tracks
  'user-read-recently-played',       // historial reciente
].join(' ');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';

/** Genera un code_verifier de 64 chars conformes a PKCE. */
function generateCodeVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

/** SHA-256 + base64url del verifier para el challenge. */
async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Inicia el flow OAuth: guarda verifier en sessionStorage, redirige a
 * Spotify. El usuario autoriza, Spotify redirige a redirectUri con ?code.
 * El callback page debe llamar exchangeCodeForToken().
 *
 * @returns {Promise<void>}
 */
export async function startSpotifyAuth() {
  if (!SPOTIFY_CLIENT_ID) {
    throw new Error('VITE_SPOTIFY_CLIENT_ID no configurado');
  }
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  // Persiste verifier + state para validar en el callback.
  try {
    sessionStorage.setItem('ritmiq.spotify-pkce-verifier', verifier);
    sessionStorage.setItem('ritmiq.spotify-pkce-state', state);
  } catch {
    throw new Error('sessionStorage no disponible');
  }

  const redirectUri = `${window.location.origin}/auth/spotify-callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
}

/**
 * Llamado desde el callback page: intercambia el code por tokens via la
 * edge function spotify-callback.
 *
 * @param {string} code  query param de la URL
 * @param {string} state query param de la URL (para validar)
 * @returns {Promise<{ ok: boolean, expiresIn?: number, error?: string }>}
 */
export async function exchangeCodeForToken(code, state) {
  if (!SUPABASE_URL) return { ok: false, error: 'Supabase no configurado' };

  // Validar state.
  let storedState, verifier;
  try {
    storedState = sessionStorage.getItem('ritmiq.spotify-pkce-state');
    verifier = sessionStorage.getItem('ritmiq.spotify-pkce-verifier');
  } catch {
    return { ok: false, error: 'sessionStorage no disponible' };
  }
  if (!storedState || storedState !== state) {
    return { ok: false, error: 'state mismatch (posible CSRF)' };
  }
  if (!verifier) {
    return { ok: false, error: 'codeVerifier no encontrado en sessionStorage' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  if (!session) return { ok: false, error: 'no autenticado en Ritmiq' };

  const redirectUri = `${window.location.origin}/auth/spotify-callback`;

  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/spotify-callback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.error ?? `HTTP ${r.status}` };

    // Limpiar storage (verifier y state ya cumplieron su funcion).
    try {
      sessionStorage.removeItem('ritmiq.spotify-pkce-verifier');
      sessionStorage.removeItem('ritmiq.spotify-pkce-state');
    } catch {}

    return { ok: true, expiresIn: data.expiresIn };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * Borra el token persistido (revoke local). El usuario debe ir a
 * https://www.spotify.com/account/apps/ para revocar tambien en el lado
 * de Spotify.
 *
 * @returns {Promise<boolean>}
 */
export async function disconnectSpotify() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  try {
    const { error } = await supabase
      .from('spotify_tokens')
      .delete()
      .eq('user_id', session.user.id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Lee el estado actual de conexion. Solo chequea presencia del token,
 * no su validez (eso lo maneja la edge function al usarlo).
 *
 * @returns {Promise<{ connected: boolean, expiresAt?: string, scope?: string }>}
 */
export async function getSpotifyConnectionStatus() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { connected: false };
  try {
    const { data } = await supabase
      .from('spotify_tokens')
      .select('expires_at, scope')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (!data) return { connected: false };
    return {
      connected: true,
      expiresAt: data.expires_at,
      scope: data.scope,
    };
  } catch {
    return { connected: false };
  }
}

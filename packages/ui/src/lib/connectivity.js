/**
 * Detector unificado de conectividad — 3 canales independientes:
 *   - internet : ¿hay red pública? (navigator.onLine + ping a Supabase)
 *   - lan      : ¿LAN server alcanzable en la misma WiFi?  (ping /health a baseUrl)
 *   - tunnel   : ¿Cloudflare Tunnel alcanzable?            (ping /health a tunnelUrl)
 *
 * Algoritmo:
 *   - Sondeo periódico con backoff exponencial **por canal** cuando falla,
 *     y a intervalo "estable" cuando responde. Esto evita martillar la red
 *     cuando algo está caído pero refresca rápido cuando algo se recupera.
 *   - El evento `online` del navegador dispara un re-chequeo inmediato.
 *   - Cada cambio de estado emite a los listeners.
 *
 * El consumidor (`useConnectivity` / App.jsx) usa este detector para decidir:
 *   - Mostrar UI de offline / LAN / tunnel.
 *   - Drenar la cola de sync al volver internet.
 *   - Recargar playlists desde Supabase al recuperar internet.
 *   - Re-resolver el audio source actual cuando aparece LAN o tunnel.
 */

import { supabase } from './supabase.js';
import { pingLan, getLanBaseUrlSync, getTunnelUrlSync } from './lan-client.js';

/** Intervalo "estable" cuando el canal responde. */
const STABLE_MS = {
  internet: 30_000,
  lan: 15_000,
  tunnel: 45_000,
};
/** Backoff inicial y máximo cuando el canal falla. */
const BACKOFF_MIN_MS = 3_000;
const BACKOFF_MAX_MS = 5 * 60_000; // 5 min

/** @typedef {{ internet:boolean, lan:boolean, tunnel:boolean, desktopReachable:boolean, source:'local'|'lan'|'tunnel'|'cloud'|'offline' }} ConnectivityState */

/** @type {ConnectivityState} */
let state = {
  internet: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lan: false,
  tunnel: false,
  desktopReachable: false,
  source: 'offline',
};

/** @type {Set<(s:ConnectivityState)=>void>} */
const listeners = new Set();

/** @type {Record<string,{timer:any, backoff:number}>} */
const channels = {
  internet: { timer: null, backoff: BACKOFF_MIN_MS },
  lan:      { timer: null, backoff: BACKOFF_MIN_MS },
  tunnel:   { timer: null, backoff: BACKOFF_MIN_MS },
};

let started = false;

export function getConnectivity() { return { ...state }; }

/**
 * @param {(s:ConnectivityState)=>void} cb
 * @returns {()=>void} unsubscribe
 */
export function onConnectivityChange(cb) {
  listeners.add(cb);
  start();
  queueMicrotask(() => cb({ ...state }));
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

function emit() {
  const snap = { ...state };
  for (const cb of listeners) { try { cb(snap); } catch {} }
}

function recomputeSource() {
  // Prioridad para el resolver: LAN > Tunnel > Cloud > offline.
  // (local-blob siempre lo prefiere `resolveAudioSource` por encima de esto.)
  const next =
    state.lan ? 'lan'
    : state.tunnel ? 'tunnel'
    : state.internet ? 'cloud'
    : 'offline';
  const reachable = state.lan || state.tunnel;
  if (next !== state.source || reachable !== state.desktopReachable) {
    state = { ...state, source: next, desktopReachable: reachable };
    return true;
  }
  return false;
}

function setChannel(name, value) {
  if (state[name] === value) return false;
  state = { ...state, [name]: value };
  recomputeSource();
  return true;
}

/* ─── probes ────────────────────────────────────────────────────────── */

async function probeInternet() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const url = supabase.supabaseUrl ?? '';
    const apikey = supabase.supabaseKey ?? '';
    if (!url) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: ctrl.signal,
      headers: apikey ? { apikey } : {},
    }).finally(() => clearTimeout(t));
    return res.ok;
  } catch { return false; }
}

async function probeLan() {
  const base = getLanBaseUrlSync();
  if (!base) return false;
  return pingLan(base, 1500);
}

async function probeTunnel() {
  const url = getTunnelUrlSync();
  if (!url) return false;
  return pingLan(url, 3500);
}

/* ─── scheduler ─────────────────────────────────────────────────────── */

function schedule(name, probe) {
  const ch = channels[name];
  const run = async () => {
    const ok = await probe();
    const changed = setChannel(name, ok);
    if (ok) {
      ch.backoff = BACKOFF_MIN_MS;
      ch.timer = setTimeout(run, STABLE_MS[name]);
    } else {
      ch.timer = setTimeout(run, ch.backoff);
      ch.backoff = Math.min(BACKOFF_MAX_MS, Math.round(ch.backoff * 1.8));
    }
    if (changed) emit();
  };
  // Primer probe inmediato
  ch.timer = setTimeout(run, 0);
}

function cancel(name) {
  const ch = channels[name];
  if (ch.timer) { clearTimeout(ch.timer); ch.timer = null; }
  ch.backoff = BACKOFF_MIN_MS;
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  schedule('internet', probeInternet);
  schedule('lan', probeLan);
  schedule('tunnel', probeTunnel);

  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);
  // Cuando la pestaña vuelve a primer plano, revalidamos.
  document.addEventListener('visibilitychange', onVisibility);
}

function stop() {
  if (!started) return;
  started = false;
  cancel('internet'); cancel('lan'); cancel('tunnel');
  window.removeEventListener('online', onBrowserOnline);
  window.removeEventListener('offline', onBrowserOffline);
  document.removeEventListener('visibilitychange', onVisibility);
}

function onBrowserOnline() {
  // Forzar re-probe rápido de todos los canales.
  forceRecheck();
}
function onBrowserOffline() {
  const a = setChannel('internet', false);
  const b = setChannel('lan', false);
  const c = setChannel('tunnel', false);
  if (a || b || c) emit();
}
function onVisibility() {
  if (document.visibilityState === 'visible') forceRecheck();
}

/** Reagenda todos los canales para sondear de inmediato. */
export function forceRecheck() {
  if (!started) return;
  cancel('internet'); schedule('internet', probeInternet);
  cancel('lan');      schedule('lan', probeLan);
  cancel('tunnel');   schedule('tunnel', probeTunnel);
}

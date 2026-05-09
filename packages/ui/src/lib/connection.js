/**
 * Detector de estado de conexión (online/offline).
 * Usa eventos del navegador + ping ligero a Supabase para confirmar.
 */

import { supabase } from './supabase.js';

const PING_INTERVAL = 25_000;

/** @type {Set<(online: boolean) => void>} */
const listeners = new Set();
let online = typeof navigator !== 'undefined' ? navigator.onLine : true;
let timer = null;

export function isOnline() { return online; }

/**
 * @param {(online: boolean) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onConnectionChange(cb) {
  listeners.add(cb);
  // Asegurar que el watcher esté activo
  startWatching();
  // Estado inicial
  queueMicrotask(() => cb(online));
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopWatching();
  };
}

function emit() {
  for (const cb of listeners) {
    try { cb(online); } catch {}
  }
}

function setOnline(next) {
  if (next === online) return;
  online = next;
  emit();
}

async function pingSupabase() {
  try {
    // Ping a /auth/v1/health con apikey: endpoint que responde 200 sin
    // requerir sesión y no genera ruido de 401 en la consola.
    const url = supabase.supabaseUrl ?? '';
    const apikey = supabase.supabaseKey ?? '';
    if (!url) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: apikey ? { apikey } : {},
    }).finally(() => clearTimeout(t));
    setOnline(res.ok);
  } catch {
    setOnline(false);
  }
}

function startWatching() {
  if (timer || typeof window === 'undefined') return;
  window.addEventListener('online',  () => { setOnline(true); pingSupabase(); });
  window.addEventListener('offline', () => setOnline(false));
  // Primer ping inmediato + intervalo
  pingSupabase();
  timer = setInterval(pingSupabase, PING_INTERVAL);
}

function stopWatching() {
  if (timer) { clearInterval(timer); timer = null; }
}

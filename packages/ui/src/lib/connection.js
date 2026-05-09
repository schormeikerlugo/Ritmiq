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
    // Ping ligero: head a la URL base del REST. Si responde algo (200/401),
    // la red al menos llega al servidor.
    const url = supabase.supabaseUrl ?? '';
    if (!url) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    setOnline(!!res);
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

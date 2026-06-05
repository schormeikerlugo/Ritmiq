import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

/**
 * @typedef {{ id: string, email: string|null }} SessionUser
 */

/**
 * ¿El error de `getUser()` indica que el usuario/token ya NO es válido
 * (justifica cerrar sesión), o es un fallo transitorio de red (NO cerrar)?
 *
 * Tratamos como error de AUTH real solo los códigos/estados que el servidor
 * de Supabase devuelve cuando el usuario no existe o el token expiró sin
 * refresh posible. Cualquier error de red/fetch/timeout se considera
 * transitorio → mantener la sesión cacheada (offline-first).
 *
 * @param {{ status?: number, name?: string, message?: string }} error
 * @returns {boolean}
 */
function isAuthError(error) {
  if (!error) return false;
  const status = error.status ?? error.code;
  // 401/403/422 → el servidor rechazó la sesión: auth real.
  if (status === 401 || status === 403 || status === 422) return true;
  const msg = String(error.message ?? '').toLowerCase();
  if (msg.includes('user not found') || msg.includes('user_not_found')) return true;
  if (msg.includes('invalid claim') || msg.includes('jwt')) return true;
  // "Failed to fetch", "NetworkError", "Load failed" (iOS), AbortError, etc.
  // → NO es auth real. Todo lo demás se considera transitorio.
  return false;
}

export const useAuthStore = create((set, get) => ({
  /** @type {SessionUser|null} */
  user: null,
  /** Cargando sesión inicial */
  loading: true,
  error: null,

  async init() {
    set({ loading: true, error: null });
    try {
      const { data: sess } = await supabase.auth.getSession();
      const cached = sess.session?.user;

      // Si hay sesión cacheada, la validamos contra el servidor.
      // getUser() hace una petición que falla si el usuario ya no existe
      // (por ejemplo tras un `supabase db reset` que limpia auth.users).
      //
      // OFFLINE-FIRST (fix pérdida de descargas): si NO hay red, getUser()
      // falla por error de RED — NO por usuario borrado. En ese caso NO
      // debemos hacer signOut (eso vaciaría la librería y "borraría" las
      // descargas de la UI hasta volver online). Confiamos en la sesión
      // cacheada y entramos directo en modo offline. Solo cerramos sesión
      // cuando hay red Y el servidor responde que el usuario no es válido.
      if (cached) {
        const online = typeof navigator === 'undefined' || navigator.onLine;
        if (!online) {
          // Sin red: confiar en la sesión cacheada, no validar.
          set({
            user: { id: cached.id, email: cached.email ?? null },
            loading: false,
          });
        } else {
          let data, error;
          try {
            ({ data, error } = await supabase.auth.getUser());
          } catch (netErr) {
            // Error de red aunque navigator.onLine diga true (timeout, DNS,
            // etc.): tratar como offline, mantener la sesión cacheada.
            set({
              user: { id: cached.id, email: cached.email ?? null },
              loading: false,
            });
            error = null; data = { user: cached };
          }
          if (error) {
            // Distinguir error de auth real (usuario borrado/token inválido)
            // de un fallo de red. Solo el primero justifica signOut.
            if (isAuthError(error)) {
              await supabase.auth.signOut();
              set({ user: null, loading: false });
            } else {
              // Error transitorio de red: conservar sesión cacheada.
              set({
                user: { id: cached.id, email: cached.email ?? null },
                loading: false,
              });
            }
          } else if (data?.user) {
            set({
              user: { id: data.user.id, email: data.user.email ?? null },
              loading: false,
            });
          } else {
            // Sin error pero sin user → sesión inválida real.
            await supabase.auth.signOut();
            set({ user: null, loading: false });
          }
        }
      } else {
        set({ user: null, loading: false });
      }

      // Suscripción a cambios de sesión
      supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user;
        set({ user: u ? { id: u.id, email: u.email ?? null } : null });
      });
    } catch (err) {
      set({ error: String(err?.message ?? err), loading: false });
    }
  },

  async signIn(email, password) {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Registra una cuenta nueva. Si se pasa username/displayName se guardan
   * en user_metadata para que el primer loadProfile() los aplique al
   * perfil social (en lugar del username random `user_<uid8>` que genera
   * el trigger de la migracion).
   *
   * @param {string} email
   * @param {string} password
   * @param {{username?:string, displayName?:string}} [meta]
   */
  async signUp(email, password, meta = {}) {
    set({ error: null });
    const options = {};
    const data = {};
    if (meta.username)    data.username     = meta.username.trim().toLowerCase();
    if (meta.displayName) data.display_name = meta.displayName.trim();
    if (Object.keys(data).length > 0) options.data = data;

    const { error } = await supabase.auth.signUp({ email, password, options });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  async signOut() {
    await supabase.auth.signOut();
    set({ user: null });
  },

  /**
   * Envia el correo de recuperacion de contraseña.
   * Supabase envia un magic link al email del usuario; al pulsarlo
   * vuelve a la app con `#access_token=...&type=recovery` que detecta
   * App.jsx para mostrar ResetPasswordView.
   */
  async resetPassword(email) {
    set({ error: null });
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/#reset-password`
      : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Actualiza la contraseña del usuario en sesion (post recovery link).
   */
  async updatePassword(newPassword) {
    set({ error: null });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));

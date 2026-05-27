import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

/**
 * @typedef {{ id: string, email: string|null }} SessionUser
 */

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
      if (cached) {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) {
          await supabase.auth.signOut();
          set({ user: null, loading: false });
        } else {
          set({
            user: { id: data.user.id, email: data.user.email ?? null },
            loading: false,
          });
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

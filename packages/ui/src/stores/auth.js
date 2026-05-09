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

  async signUp(email, password) {
    set({ error: null });
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  async signOut() {
    await supabase.auth.signOut();
    set({ user: null });
  },

  clearError: () => set({ error: null }),
}));

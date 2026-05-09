import { createClient } from '@supabase/supabase-js';

/**
 * @param {string} url
 * @param {string} anonKey
 */
export function createSupabase(url, anonKey) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

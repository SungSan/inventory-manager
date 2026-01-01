import { supabaseAdmin } from './supabase';

export async function ensureIdempotent(key: string, userId: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('idempotency_keys').insert({ key, created_by: userId, created_at: now });
  if (error && error.code !== '23505') {
    throw error;
  }
}

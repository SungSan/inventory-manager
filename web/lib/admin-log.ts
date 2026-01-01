import { supabaseAdmin } from './supabase';
import type { SessionData } from './session';

export async function recordAdminLog(session: SessionData, action: string, detail?: string) {
  const payload = {
    actor_id: session.userId ?? null,
    actor_email: session.email ?? null,
    action,
    detail: detail ?? null,
  };

  await supabaseAdmin.from('admin_logs').insert(payload);
}

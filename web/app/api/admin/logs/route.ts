import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

export async function GET() {
  return withAuth(['admin'], async () => {
    const { data, error } = await supabaseAdmin
      .from('admin_logs')
      .select('id, action, detail, actor_email, actor_id, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const normalized = (data || []).map((row: any) => ({
      ...row,
      detail: typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail ?? {}),
    }));

    return NextResponse.json(normalized);
  });
}

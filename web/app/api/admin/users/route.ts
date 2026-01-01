import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordAdminLog } from '../../../../lib/admin-log';
import type { Role } from '../../../../lib/session';

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { email, password, role } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const userRole: Role = (role as Role) || 'operator';

    const { data, error } = await supabaseAdmin.rpc('create_user', {
      p_email: normalizedEmail,
      p_password: String(password),
      p_role: userRole
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const row = Array.isArray(data) ? data[0] : data;

    await recordAdminLog(session, 'create_user', `${normalizedEmail} (${row?.role ?? userRole})`);

    return NextResponse.json({ ok: true, role: row?.role ?? userRole });
  });
}

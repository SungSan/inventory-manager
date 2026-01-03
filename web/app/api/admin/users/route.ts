import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordAdminLog } from '../../../../lib/admin-log';
import { createUserWithProfile } from '../../../../lib/create-user';
import type { Role } from '../../../../lib/session';

export async function GET() {
  return withAuth(['admin'], async () => {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, department, contact, purpose, role, active, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { email, password, role, full_name, department, contact, purpose } = await req.json();

    if (!email || !password || !full_name || !department) {
      return NextResponse.json({ error: '계정/비밀번호/성함/부서를 모두 입력하세요.' }, { status: 400 });
    }

    const userRole: Role = (role as Role) || 'operator';

    try {
      const result = await createUserWithProfile({
        id: String(email).toLowerCase().trim(),
        password: String(password),
        role: userRole,
        full_name: String(full_name ?? ''),
        department: String(department ?? ''),
        contact: String(contact ?? ''),
        purpose: String(purpose ?? ''),
      });

      await recordAdminLog(
        session,
        'create_user',
        `${email} (${result.role}) / ${full_name ?? ''}`
      );

      return NextResponse.json({ ok: true, role: result.role, user_id: result.userId });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
    }
  });
}

export async function PATCH(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { id, role, active } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (role) updates.role = role as Role;
    if (typeof active === 'boolean') updates.active = active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'no updates provided' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('users').update(updates).eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await recordAdminLog(session, 'update_user', `${id} ${role ?? ''} ${active ?? ''}`.trim());

    return NextResponse.json({ ok: true });
  });
}

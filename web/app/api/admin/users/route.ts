import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordAdminLog } from '../../../../lib/admin-log';
import { createUserWithProfile } from '../../../../lib/create-user';
import type { Role } from '../../../../lib/session';

export async function GET() {
  return withAuth(['admin'], async () => {
    const { data, error } = await supabaseAdmin
      .from('admin_users_view')
      .select('id,email,full_name,department,contact,purpose,role,approved,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const mapped = (data || []).map((row: any) => ({
      id: row.id,
      username: (row.email ?? '').split('@')[0] || row.email || '',
      approved: Boolean(row.approved),
      role: (row.role as Role | undefined) ?? 'viewer',
      email: row.email ?? '',
      full_name: row.full_name ?? '',
      department: row.department ?? '',
      contact: row.contact ?? '',
      purpose: row.purpose ?? '',
      created_at: row.created_at ?? '',
    }));

    return NextResponse.json(mapped);
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { username, password, role, full_name, department, contact, purpose } = await req.json();

    if (!username || !full_name || !department) {
      return NextResponse.json({ error: 'ID/성함/부서를 모두 입력하세요.' }, { status: 400 });
    }

    const userRole: Role = (role as Role) || 'viewer';

    try {
      const result = await createUserWithProfile({
        username: String(username).toLowerCase().trim(),
        password: password ? String(password) : undefined,
        role: userRole,
        active: true,
        approved: true,
        approved_by: session.userId,
        full_name: String(full_name ?? ''),
        department: String(department ?? ''),
        contact: String(contact ?? ''),
        purpose: String(purpose ?? ''),
      });

      await recordAdminLog(
        session,
        'create_user',
        `${username} (${result.role}) / ${full_name ?? ''}`
      );

      return NextResponse.json({ ok: true, role: result.role, user_id: result.userId });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
    }
  });
}

export async function PATCH(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { id, role, approved } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    const profileUpdates: Record<string, any> = {};

    if (typeof approved === 'boolean') {
      updates.approved = approved;
      profileUpdates.approved = approved;
      profileUpdates.approved_at = approved ? new Date().toISOString() : null;
      profileUpdates.approved_by = approved ? session.userId : null;
    }

    if (role) {
      const allowed: Role[] = ['admin', 'operator', 'viewer'];
      if (!allowed.includes(role as Role)) {
        return NextResponse.json({ error: 'invalid role' }, { status: 400 });
      }
      updates.role = role as Role;
      profileUpdates.role = role as Role;
    }

    if (Object.keys(updates).length === 0 && Object.keys(profileUpdates).length === 0) {
      return NextResponse.json({ error: 'no updates provided' }, { status: 400 });
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin.from('users').update(updates).eq('id', id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabaseAdmin.from('user_profiles').update(profileUpdates).eq('user_id', id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    await recordAdminLog(session, 'update_user', `${id} ${role ?? ''} ${approved ?? ''}`.trim());

    return NextResponse.json({ ok: true });
  });
}

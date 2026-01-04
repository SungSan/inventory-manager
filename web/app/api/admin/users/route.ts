import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
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

export async function PATCH(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { id, role, approved } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: Record<string, any> = {};

    if (typeof approved === 'boolean') {
      updates.approved = approved;
    }

    if (role) {
      const allowed: Role[] = ['admin', 'operator', 'viewer'];
      if (!allowed.includes(role as Role)) {
        return NextResponse.json({ error: 'invalid role' }, { status: 400 });
      }
      updates.role = role as Role;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'no updates provided' }, { status: 400 });
    }

    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id,email,full_name,department,contact,purpose,role,approved,created_at')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message, step: 'update_users' }, { status: 400 });
    }

    if (typeof approved === 'boolean') {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          approved,
          approved_at: approved ? new Date().toISOString() : null,
          approved_by: approved ? session.userId : null,
        })
        .eq('user_id', id);

      if (profileError) {
        return NextResponse.json(
          { error: profileError.message, step: 'update_user_profiles' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ ok: true, user: updatedUser });
  });
}

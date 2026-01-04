import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import type { Role } from '../../../../lib/session';

type AdminUserRow = {
  id: string;
  email: string;
  full_name?: string | null;
  department?: string | null;
  contact?: string | null;
  purpose?: string | null;
  role: Role;
  approved: boolean;
  active: boolean;
  created_at: string;
};

function mapAdminUser(row: AdminUserRow) {
  return {
    id: row.id,
    username: (row.email ?? '').split('@')[0] || row.email || '',
    approved: Boolean(row.approved),
    active: Boolean(row.active),
    role: (row.role as Role | undefined) ?? 'viewer',
    email: row.email ?? '',
    full_name: row.full_name ?? '',
    department: row.department ?? '',
    contact: row.contact ?? '',
    purpose: row.purpose ?? '',
    created_at: row.created_at ?? '',
  };
}

export async function GET() {
  return withAuth(['admin'], async () => {
    const { data, error } = await supabaseAdmin
      .from('admin_users_view')
      .select('id,email,full_name,department,contact,purpose,role,approved,active,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const mapped = (data || []).map((row: AdminUserRow) => mapAdminUser(row));

    return NextResponse.json(mapped);
  });
}

export async function PATCH(req: Request) {
  return withAuth(['admin'], async (session) => {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json({ ok: false, step: 'parse_body', error: 'invalid json body' }, { status: 400 });
    }

    const { id, role, approved } = body ?? {};
    if (!id) {
      return NextResponse.json({ ok: false, step: 'validation', error: 'id is required' }, { status: 400 });
    }

    const actorId = session.userId ?? (session as any)?.user?.id ?? (session as any)?.user_id ?? null;
    if (!actorId) {
      return NextResponse.json(
        { ok: false, step: 'validation', error: 'missing actor id' },
        { status: 401 }
      );
    }

    const updates: Record<string, any> = {};

    if (typeof approved === 'boolean') {
      updates.approved = approved;
      updates.active = approved;
    }

    if (typeof role !== 'undefined') {
      const allowed: Role[] = ['admin', 'operator', 'viewer'];
      if (!allowed.includes(role as Role)) {
        return NextResponse.json({ ok: false, step: 'validation', error: 'invalid role' }, { status: 400 });
      }
      updates.role = role as Role;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, step: 'validation', error: 'no updates provided' }, { status: 400 });
    }

    const { data: existingUser, error: fetchUserError } = await supabaseAdmin
      .from('users')
      .select('approved, role, active')
      .eq('id', id)
      .single();

    if (fetchUserError) {
      return NextResponse.json(
        { ok: false, step: 'fetch_user', error: fetchUserError.message },
        { status: 500 }
      );
    }

    const { data: updatedUser, error: updateUsersError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id,email,role,approved,active,created_at')
      .single();

    if (updateUsersError) {
      return NextResponse.json(
        {
          ok: false,
          step: 'update_users',
          error: updateUsersError.message,
          details: (updateUsersError as any)?.details ?? null,
          hint: (updateUsersError as any)?.hint ?? null,
          code: (updateUsersError as any)?.code ?? null,
        },
        { status: 500 }
      );
    }

    if (!updatedUser) {
      return NextResponse.json(
        { ok: false, step: 'update_users', error: 'no user row returned' },
        { status: 500 }
      );
    }

    if (typeof approved === 'boolean') {
      const profileUpdates = {
        approved,
        approved_at: approved ? new Date().toISOString() : null,
        approved_by: approved ? actorId : null,
      };

      const { data: profileRow, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', id)
        .select('user_id')
        .single();

      if (profileError || !profileRow) {
        await supabaseAdmin
          .from('users')
          .update({ approved: existingUser?.approved, role: existingUser?.role, active: existingUser?.active })
          .eq('id', id);

        return NextResponse.json(
          {
            ok: false,
            step: 'update_user_profiles',
            error: profileError?.message || 'failed to update user_profiles',
            details: (profileError as any)?.details ?? null,
            hint: (profileError as any)?.hint ?? null,
            code: (profileError as any)?.code ?? null,
          },
          { status: 500 }
        );
      }
    }

    const { data: viewRow, error: viewError } = await supabaseAdmin
      .from('admin_users_view')
      .select('id,email,full_name,department,contact,purpose,role,approved,active,created_at')
      .eq('id', id)
      .single();

    if (viewError || !viewRow) {
      return NextResponse.json(
        {
          ok: false,
          step: 'admin_users_view',
          error: viewError?.message || 'failed to load admin_users_view',
          details: (viewError as any)?.details ?? null,
          hint: (viewError as any)?.hint ?? null,
          code: (viewError as any)?.code ?? null,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, user: mapAdminUser(viewRow as AdminUserRow) });
  });
}

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
  primary_location?: string | null;
  sub_locations?: string[] | null;
};

function normalizeRole(value: any): Role | undefined {
  if (!value) return undefined;
  const raw = String(value);
  if (raw === 'l-operator' || raw === 'L-operator' || raw === 'L_operator') return 'l_operator';
  if (raw === 'l_operator') return 'l_operator';
  if (raw === 'operator' || raw === 'admin' || raw === 'viewer') return raw as Role;
  return undefined;
}

function mapAdminUser(row: AdminUserRow) {
  return {
    id: row.id,
    username: (row.email ?? '').split('@')[0] || row.email || '',
    approved: Boolean(row.approved),
    active: Boolean(row.active),
    role: normalizeRole(row.role) ?? 'viewer',
    email: row.email ?? '',
    full_name: row.full_name ?? '',
    department: row.department ?? '',
    contact: row.contact ?? '',
    purpose: row.purpose ?? '',
    created_at: row.created_at ?? '',
    primary_location: row.primary_location ?? '',
    sub_locations: row.sub_locations ?? [],
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

    const ids = (data || []).map((row) => row.id).filter(Boolean);
    let scopeMap: Record<string, { primary_location?: string | null; sub_locations?: string[] | null }> = {};
    if (ids.length > 0) {
      const { data: scopes } = await supabaseAdmin
        .from('user_location_permissions')
        .select('user_id, primary_location, sub_locations')
        .in('user_id', ids);
      scopeMap = Object.fromEntries(
        (scopes || []).map((row: any) => [row.user_id, { primary_location: row.primary_location, sub_locations: row.sub_locations }])
      );
    }

    const mapped = (data || []).map((row: AdminUserRow) =>
      mapAdminUser({ ...row, primary_location: scopeMap[row.id]?.primary_location ?? null, sub_locations: scopeMap[row.id]?.sub_locations ?? [] })
    );

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

    const { id, role, approved, primary_location, sub_locations } = body ?? {};
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

    const hasScope = typeof primary_location === 'string' || Array.isArray(sub_locations);

    if (typeof approved === 'boolean') {
      updates.approved = approved;
      updates.active = approved;
    }

    if (typeof role !== 'undefined') {
      const normalizedRole = normalizeRole(role);
      const allowed: Role[] = ['admin', 'operator', 'viewer', 'l_operator'];
      if (!normalizedRole || !allowed.includes(normalizedRole)) {
        return NextResponse.json({ ok: false, step: 'validation', error: 'invalid role' }, { status: 400 });
      }
      updates.role = normalizedRole;
    }

    if (Object.keys(updates).length === 0 && !hasScope) {
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

    let updatedUser = existingUser;
    if (Object.keys(updates).length > 0) {
      const response = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', id)
        .select('id,email,role,approved,active,created_at')
        .single();

      if (response.error) {
        return NextResponse.json(
          {
            ok: false,
            step: 'update_users',
            error: response.error.message,
            details: (response.error as any)?.details ?? null,
            hint: (response.error as any)?.hint ?? null,
            code: (response.error as any)?.code ?? null,
          },
          { status: 500 }
        );
      }
      updatedUser = response.data as any;
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

    if (hasScope) {
      const primary = typeof primary_location === 'string' ? primary_location.trim() : '';
      const subs = Array.isArray(sub_locations) ? sub_locations.filter(Boolean) : [];
      if (!primary) {
        return NextResponse.json(
          { ok: false, step: 'location_scope', error: 'primary_location is required for l-operator' },
          { status: 400 }
        );
      }

      const { error: scopeError } = await supabaseAdmin
        .from('user_location_permissions')
        .upsert({ user_id: id, primary_location: primary, sub_locations: subs })
        .select('user_id')
        .single();

      if (scopeError) {
        return NextResponse.json(
          { ok: false, step: 'location_scope', error: scopeError.message },
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

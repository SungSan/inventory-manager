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
  created_at: string;
};

function mapAdminUser(row: AdminUserRow) {
  return {
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
  };
}

export async function GET() {
  return withAuth(['admin'], async () => {
    const { data, error } = await supabaseAdmin
      .from('admin_users_view')
      .select('id,email,full_name,department,contact,purpose,role,approved,created_at')
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
    const { id, role, approved } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
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

    const { data, error } = await supabaseAdmin.rpc('admin_update_user', {
      id,
      approved,
      role,
      actor_id: actorId,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          step: 'admin_update_user_rpc',
          error: error.message,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          code: (error as any)?.code ?? null,
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, step: 'admin_update_user_rpc', error: 'no data returned' },
        { status: 500 }
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ ok: true, user: mapAdminUser(row as AdminUserRow) });
  });
}

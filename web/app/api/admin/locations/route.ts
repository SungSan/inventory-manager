import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordAdminLog } from '../../../../lib/admin-log';

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const { data, error } = await supabaseAdmin.from('locations').select('name').order('name');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json((data ?? []).map((row) => row.name));
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { name } = await req.json();
    const normalized = String(name || '').trim();

    if (!normalized) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('locations')
      .upsert({ name: normalized }, { onConflict: 'name' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await recordAdminLog(session, 'location_upsert', normalized);

    const { data: updated } = await supabaseAdmin.from('locations').select('name').order('name');
    return NextResponse.json((updated ?? []).map((row) => row.name));
  });
}

export async function DELETE(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { name } = await req.json();
    const normalized = String(name || '').trim();

    if (!normalized) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('locations').delete().eq('name', normalized);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await recordAdminLog(session, 'location_delete', normalized);

    const { data: updated } = await supabaseAdmin.from('locations').select('name').order('name');
    return NextResponse.json((updated ?? []).map((row) => row.name));
  });
}

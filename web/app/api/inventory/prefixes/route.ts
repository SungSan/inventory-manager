import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';

function getLocationPrefix(location?: string | null) {
  const value = String(location ?? '').trim();
  if (!value) return '';
  const [prefix] = value.split('-');
  return prefix || value;
}

async function loadLocationScope(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_location_permissions')
    .select('primary_location, sub_locations')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async (session) => {
    let query = supabaseAdmin.from('inventory_view').select('location').order('location', { ascending: true });
    if (session.role === 'manager') {
      const scope = await loadLocationScope(session.userId ?? '');
      const primary = scope?.primary_location ? [scope.primary_location] : [];
      const subs = Array.isArray(scope?.sub_locations) ? scope?.sub_locations : [];
      const allowedLocations = Array.from(new Set([...primary, ...subs].map((v) => String(v || '').trim()).filter(Boolean)));
      if (allowedLocations.length === 0) {
        return NextResponse.json({ ok: true, prefixes: [] }, { headers: { 'Cache-Control': 'no-store' } });
      }
      query = query.in('location', allowedLocations);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const prefixes = Array.from(
      new Set(
        (data ?? [])
          .map((row) => getLocationPrefix((row as { location?: string | null }).location).trim().toUpperCase())
          .filter(Boolean)
      )
    ).sort();

    return NextResponse.json(
      {
        ok: true,
        prefixes,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { unstable_noStore as noStore } from 'next/cache';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

async function loadLocationScope(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_location_permissions')
    .select('primary_location, sub_locations')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET(req: Request) {
  noStore();
  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async (session) => {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const pageParam = Number(searchParams.get('page'));
    const pageSizeParam = Number(searchParams.get('pageSize'));
    const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(pageSizeParam, 200) : 200;
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const offset = (page - 1) * pageSize;

    const toKstStart = (value: string) => `${value}T00:00:00+09:00`;
    const toKstEndExclusive = (value: string) => {
      const base = new Date(`${value}T00:00:00+09:00`);
      base.setDate(base.getDate() + 1);
      return base.toISOString();
    };

    let query = supabaseAdmin
      .from('movements_view')
      .select(
        'created_at, direction, artist, category, album_version, option, location, quantity, memo, item_id, created_by, created_by_name, created_by_department',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (session.role === 'manager') {
      const scope = await loadLocationScope(session.userId ?? '');
      const primary = scope?.primary_location ? [scope.primary_location] : [];
      const subs = Array.isArray(scope?.sub_locations) ? scope?.sub_locations : [];
      const allowedLocations = Array.from(new Set([...primary, ...subs].map((v) => String(v || '').trim()).filter(Boolean)));
      if (allowedLocations.length === 0) {
        return NextResponse.json({ ok: true, rows: [], page: { page, pageSize, totalRows: 0 } });
      }
      query = query.in('location', allowedLocations);
    }

    if (startDate) {
      query = query.gte('created_at', toKstStart(startDate));
    }

    if (endDate) {
      query = query.lt('created_at', toKstEndExclusive(endDate));
    }

    const { data, error, count } = await query;
    if (error) {
      console.error('history fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data && data.length > 0) {
      console.info('[history] latest_created_at', { created_at: data[0]?.created_at });
    }
    return NextResponse.json(
      { ok: true, rows: data || [], page: { page, pageSize, totalRows: count ?? 0 } },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
          'Surrogate-Control': 'no-store',
        },
      }
    );
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { unstable_noStore as noStore } from 'next/cache';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

export async function GET(req: Request) {
  noStore();
  return withAuth(['admin', 'operator', 'viewer', 'l_operator'], async () => {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const toKstStart = (value: string) => `${value}T00:00:00+09:00`;
    const toKstEndExclusive = (value: string) => {
      const base = new Date(`${value}T00:00:00+09:00`);
      base.setDate(base.getDate() + 1);
      return base.toISOString();
    };

    let query = supabaseAdmin
      .from('movements_view')
      .select(
        'id, created_at, direction, artist, category, album_version, option, barcode, location, from_location, to_location, quantity, memo, item_id, created_by, transfer_group_id, created_by_name, created_by_department'
      )
      .order('created_at', { ascending: false })
      .limit(200);

    if (startDate) {
      query = query.gte('created_at', toKstStart(startDate));
    }

    if (endDate) {
      query = query.lt('created_at', toKstEndExclusive(endDate));
    }

    const { data, error } = await query;
    if (error) {
      console.error('history fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data && data.length > 0) {
      console.info('[history] latest_created_at', { created_at: data[0]?.created_at });
    }
    return NextResponse.json(
      { ok: true, rows: data || [] },
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

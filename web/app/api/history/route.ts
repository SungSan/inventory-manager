export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { unstable_noStore as noStore } from 'next/cache';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

export async function GET(req: Request) {
  noStore();
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const { data, error } = await supabaseAdmin
      .from('movements_view')
      .select(
        'created_at, direction, artist, category, album_version, option, location, quantity, memo, item_id, created_by, created_by_name, created_by_department'
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('history fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data && data.length > 0) {
      console.info('[history] latest_created_at', { created_at: data[0]?.created_at });
    }
    return NextResponse.json(data || [], {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  });
}

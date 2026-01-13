import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

export async function GET(req: Request) {
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const { searchParams } = new URL(req.url);
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const search = searchParams.get('search')?.trim();
    const direction = searchParams.get('direction')?.trim();
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const isPaginated =
      Boolean(pageParam || pageSizeParam || search || direction || from || to);

    if (!isPaginated) {
      const { data, error } = await supabaseAdmin
        .from('movements_view')
        .select('created_at, direction, artist, category, album_version, option, location, quantity, memo, created_by')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data || []);
    }

    const page = Math.max(1, Number(pageParam || 1));
    const pageSize = Math.min(200, Math.max(1, Number(pageSizeParam || 50)));
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    let query = supabaseAdmin
      .from('movements_view')
      .select('created_at, direction, artist, category, album_version, option, location, quantity, memo, created_by', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);

    if (direction) {
      query = query.eq('direction', direction);
    }
    if (from) {
      query = query.gte('created_at', new Date(from).toISOString());
    }
    if (to) {
      query = query.lte('created_at', new Date(`${to}T23:59:59`).toISOString());
    }
    if (search) {
      const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
      query = query.or(
        [
          `artist.ilike.%${escaped}%`,
          `album_version.ilike.%${escaped}%`,
          `option.ilike.%${escaped}%`,
          `location.ilike.%${escaped}%`,
          `created_by.ilike.%${escaped}%`,
          `memo.ilike.%${escaped}%`,
        ].join(','),
      );
    }

    const { data, error, count } = await query;
    if (error) {
      console.error('history_fetch_failed', { step: 'history_fetch', message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      data: data || [],
      page,
      pageSize,
      total: count ?? (data ? data.length : 0),
    });
  });
}

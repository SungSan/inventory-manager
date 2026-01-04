import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || undefined;
  const location = searchParams.get('location') || undefined;
  const category = searchParams.get('category') || undefined;
  const albumVersion = searchParams.get('album_version') || undefined;
  const q = searchParams.get('q') || undefined;
  const limitParam = Number(searchParams.get('limit'));
  const offsetParam = Number(searchParams.get('offset'));
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  return withAuth(['admin', 'operator', 'viewer'], async () => {
    let query = supabaseAdmin
      .from('inventory_view')
      .select('artist,category,album_version,option,location,quantity', { count: 'exact' })
      .order('artist', { ascending: true })
      .order('album_version', { ascending: true })
      .order('option', { ascending: true })
      .order('location', { ascending: true })
      .range(offset, offset + limit - 1);

    if (artist) query = query.eq('artist', artist);
    if (location) query = query.eq('location', location);
    if (category) query = query.eq('category', category);
    if (albumVersion) {
      const term = `%${albumVersion}%`;
      query = query.ilike('album_version', term);
    }

    if (q) {
      const term = `%${q}%`;
      query = query.or(
        ['artist', 'album_version', 'option', 'location'].map((col) => `${col}.ilike.${term}`).join(',')
      );
    }

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        rows: data ?? [],
        page: { limit, offset, totalRows: count ?? 0 },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}

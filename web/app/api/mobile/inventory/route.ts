import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuthMobile } from '../../../../lib/auth_mobile';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';

  return withAuthMobile(['admin', 'operator', 'viewer', 'l_operator'], req, async () => {
    let query = supabaseAdmin
      .from('inventory_view')
      .select('item_id, artist, category, album_version, location, quantity, barcode')
      .order('artist', { ascending: true })
      .order('album_version', { ascending: true })
      .order('location', { ascending: true });

    const term = q.trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        [`artist.ilike.${like}`, `album_version.ilike.${like}`, `barcode.ilike.${like}`].join(',')
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  });
}

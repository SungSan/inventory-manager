import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

export async function GET(req: Request) {
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const { data, error } = await supabaseAdmin
      .from('movements_view')
      .select(
        'created_at, direction, artist, category, album_version, option, location, quantity, memo, created_by, created_by_name, created_by_department'
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  });
}

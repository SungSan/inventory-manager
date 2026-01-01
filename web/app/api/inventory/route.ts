import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

export async function GET(req: Request) {
  return withAuth(req as any, ['admin', 'operator', 'viewer'], async () => {
    const { data, error } = await supabaseAdmin
      .from('inventory_view')
      .select('artist, category, album_version, option, location, quantity');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  });
}

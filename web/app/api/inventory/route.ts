import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

type InventoryRow = {
  id: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
};

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .select('id, quantity, location, items:items(artist, category, album_version, option)')
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows: InventoryRow[] = (data || []).map((row: any) => ({
      id: row.id,
      artist: row.items?.artist ?? '',
      category: row.items?.category ?? '',
      album_version: row.items?.album_version ?? '',
      option: row.items?.option ?? '',
      location: row.location,
      quantity: row.quantity,
    }));

    return NextResponse.json(rows);
  });
}

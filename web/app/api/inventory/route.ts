import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

type InventoryLocation = {
  id: string;
  location: string;
  quantity: number;
};

type InventoryRow = {
  key: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  total_quantity: number;
  locations: InventoryLocation[];
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

    const grouped = new Map<string, InventoryRow>();
    const order: string[] = [];

    (data || []).forEach((row: any) => {
      const artist = row.items?.artist ?? '';
      const category = row.items?.category ?? '';
      const album_version = row.items?.album_version ?? '';
      const option = row.items?.option ?? '';
      const key = `${artist}|${category}|${album_version}|${option}`;

      if (!grouped.has(key)) {
        order.push(key);
        grouped.set(key, {
          key,
          artist,
          category,
          album_version,
          option,
          total_quantity: 0,
          locations: [],
        });
      }

      const entry = grouped.get(key)!;
      entry.total_quantity += row.quantity ?? 0;
      entry.locations.push({
        id: row.id,
        location: row.location,
        quantity: row.quantity,
      });
    });

    const rows: InventoryRow[] = order.map((key) => grouped.get(key)!).map((row) => ({
      ...row,
      locations: row.locations.sort((a, b) => a.location.localeCompare(b.location)),
    }));

    return NextResponse.json(rows);
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';

export type BarcodeConflict = {
  id: string;
  artist: string;
  category: string;
  album_version: string;
};

type FindBarcodeConflictParams = {
  client: SupabaseClient;
  barcode: string;
  itemId?: string | null;
  artist: string;
  category: string;
  albumVersion: string;
};

export async function findBarcodeConflict(params: FindBarcodeConflictParams): Promise<BarcodeConflict | null> {
  const { client, barcode, itemId, artist, category, albumVersion } = params;
  let query = client
    .from('items')
    .select('id, artist, category, album_version')
    .eq('barcode', barcode);

  if (itemId) {
    query = query.neq('id', itemId);
  }

  query = query.or(`artist.neq.${artist},category.neq.${category},album_version.neq.${albumVersion}`);

  const { data, error } = await query;
  if (error) {
    console.error('[barcode] lookup failed', { error: error.message, barcode });
    return null;
  }

  return (
    data || []
  ).find(
    (row) =>
      row.artist !== artist ||
      row.category !== category ||
      row.album_version !== albumVersion
  ) ?? null;
}

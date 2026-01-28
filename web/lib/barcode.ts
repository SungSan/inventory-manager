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
  itemId: string;
};

type BarcodeGroup = {
  artist: string;
  category: string;
  album_version: string;
};

function normalizeValue(value: unknown) {
  return String(value ?? '').trim();
}

async function loadItemGroup(
  client: SupabaseClient,
  itemId: string
): Promise<BarcodeGroup | null> {
  const { data, error } = await client
    .from('items')
    .select('artist, category, album_version')
    .eq('id', itemId)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.error('[barcode] item lookup failed', { error: error.message, itemId });
    }
    return null;
  }
  return {
    artist: normalizeValue(data.artist),
    category: normalizeValue(data.category),
    album_version: normalizeValue(data.album_version),
  };
}

export async function findBarcodeConflict(params: FindBarcodeConflictParams): Promise<BarcodeConflict | null> {
  const { client, barcode, itemId } = params;
  const trimmedBarcode = normalizeValue(barcode);
  if (!trimmedBarcode) return null;

  const itemGroup = await loadItemGroup(client, itemId);
  if (!itemGroup) {
    throw new Error('barcode conflict check requires a valid item group');
  }

  const { data, error } = await client.rpc('find_barcode_conflict', {
    p_barcode: trimmedBarcode,
    p_current_item_id: itemId,
    p_artist: itemGroup.artist,
    p_category: itemGroup.category,
    p_album_version: itemGroup.album_version,
  });
  if (error) {
    console.error('[barcode] lookup failed', { error: error.message, barcode });
    return null;
  }

  return (data || [])[0] ?? null;
}

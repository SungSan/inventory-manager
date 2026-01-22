import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';

async function hasBarcodeConflict(
  barcode: string,
  artist: string,
  category: string,
  albumVersion: string
) {
  const { data, error } = await supabaseAdmin
    .from('items')
    .select('artist, category, album_version')
    .eq('barcode', barcode);
  if (error) {
    console.error('[inventory] barcode lookup failed', { error: error.message });
    return false;
  }
  return (data ?? []).some(
    (row) =>
      row.artist !== artist ||
      row.category !== category ||
      row.album_version !== albumVersion
  );
}

async function getInventoryRow(id: string) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, quantity, location, items:items(artist, category, album_version, option, barcode)')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withAuth(['admin', 'operator'], async (session) => {
    const body = await req.json();
    const { artist, category, album_version, option, location, quantity, barcode } = body;

    const current = await getInventoryRow(params.id);
    if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const baseItem = Array.isArray(current.items) ? current.items[0] ?? {} : current.items ?? {};
    const trimmedBarcode = barcode === undefined || barcode === null ? undefined : String(barcode).trim();
    if (typeof trimmedBarcode === 'string' && trimmedBarcode.length > 0 && (trimmedBarcode.length > 64 || /\s/.test(trimmedBarcode))) {
      return NextResponse.json(
        { error: 'barcode must be 1~64 characters with no spaces', step: 'validation' },
        { status: 400 }
      );
    }
    const nextItem = {
      artist: (artist ?? baseItem.artist ?? '').trim(),
      category: (category ?? baseItem.category ?? 'album').trim(),
      album_version: (album_version ?? baseItem.album_version ?? '').trim(),
      option: (option ?? baseItem.option ?? '').trim(),
      barcode: trimmedBarcode === '' ? null : trimmedBarcode ?? baseItem.barcode ?? null,
    };

    if (!nextItem.artist || !nextItem.album_version) {
      return NextResponse.json({ error: 'artist and album_version are required' }, { status: 400 });
    }

    if (
      trimmedBarcode &&
      (await hasBarcodeConflict(trimmedBarcode, nextItem.artist, nextItem.category, nextItem.album_version))
    ) {
      return NextResponse.json(
        { error: 'barcode already used by another item', step: 'barcode_scope' },
        { status: 409 }
      );
    }

    if (session.role !== 'admin' && baseItem.barcode && trimmedBarcode !== undefined && trimmedBarcode !== baseItem.barcode) {
      return NextResponse.json(
        { error: 'barcode update not allowed', step: 'barcode_scope' },
        { status: 403 }
      );
    }

    const { data: itemData, error: itemError } = await supabaseAdmin
      .from('items')
      .upsert(nextItem, { onConflict: 'artist,category,album_version,option' })
      .select('id')
      .single();

    if (itemError) {
      console.error('inventory item update error', { step: 'update_items', error: itemError.message });
      return NextResponse.json({ error: itemError.message, step: 'update_items' }, { status: 400 });
    }

    const targetQuantity = quantity === undefined || quantity === null ? current.quantity : Number(quantity);

    const { error: invError } = await supabaseAdmin
      .from('inventory')
      .update({
        item_id: itemData?.id,
        location: (location ?? current.location ?? '').trim(),
        quantity: targetQuantity,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    if (invError) {
      console.error('inventory update error', { step: 'update_inventory', error: invError.message });
      return NextResponse.json({ error: invError.message, step: 'update_inventory' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return withAuth(['admin'], async () => {
    const { error } = await supabaseAdmin.from('inventory').delete().eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}

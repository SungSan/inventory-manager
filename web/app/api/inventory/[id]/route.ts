import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';
import { findBarcodeConflict } from '../../../../lib/barcode';

function normalizeOption(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized === '-' ? '' : normalized;
}

async function getInventoryRow(id: string) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, quantity, location, items:items(id, artist, category, album_version, option, barcode)')
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
    if (
      typeof trimmedBarcode === 'string' &&
      trimmedBarcode.length > 0 &&
      (trimmedBarcode.length > 64 || /\s/.test(trimmedBarcode))
    ) {
      return NextResponse.json(
        { error: 'barcode must be 1~64 characters with no spaces', step: 'validation' },
        { status: 400 }
      );
    }
    const normalizedBarcode = trimmedBarcode === undefined ? undefined : trimmedBarcode === '' ? null : trimmedBarcode;
    const baseBarcode = baseItem.barcode === undefined || baseItem.barcode === null ? null : String(baseItem.barcode).trim();
    const baseBarcodeNormalized = baseBarcode ? baseBarcode.toLowerCase() : baseBarcode;
    const nextBarcodeNormalized =
      typeof normalizedBarcode === 'string' ? normalizedBarcode.toLowerCase() : normalizedBarcode;
    const nextItem = {
      artist: String(artist ?? baseItem.artist ?? '').trim(),
      category: String(category ?? baseItem.category ?? 'album').trim(),
      album_version: String(album_version ?? baseItem.album_version ?? '').trim(),
      option: normalizeOption(option ?? baseItem.option ?? ''),
    };

    if (!nextItem.artist || !nextItem.album_version) {
      return NextResponse.json({ error: 'artist and album_version are required' }, { status: 400 });
    }

    if (
      session.role !== 'admin' &&
      baseBarcodeNormalized &&
      trimmedBarcode !== undefined &&
      nextBarcodeNormalized !== baseBarcodeNormalized
    ) {
      return NextResponse.json(
        { error: 'barcode update not allowed', step: 'barcode_scope' },
        { status: 403 }
      );
    }

    const { data: itemData, error: itemError } = await supabaseAdmin
      .from('items')
      .upsert(nextItem, { onConflict: 'artist,category,album_version,option' })
      .select('id, artist, category, album_version')
      .single();

    if (itemError) {
      console.error('inventory item update error', { step: 'update_items', error: itemError.message });
      return NextResponse.json({ error: itemError.message, step: 'update_items' }, { status: 400 });
    }

    if (typeof normalizedBarcode === 'string' && normalizedBarcode.length > 0) {
      const conflict = await findBarcodeConflict({
        client: supabaseAdmin,
        barcode: normalizedBarcode,
        itemId: itemData.id,
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: '동일 바코드는 다른 아티스트/카테고리/앨범에서는 사용할 수 없습니다.',
            conflict,
            step: 'update_items_barcode',
          },
          { status: 409 }
        );
      }
    }

    if (normalizedBarcode !== undefined) {
      const { error: barcodeError } = await supabaseAdmin
        .from('items')
        .update({ barcode: normalizedBarcode })
        .eq('id', itemData?.id);
      if (barcodeError) {
        const message =
          barcodeError.code === '23505'
            ? '동일 바코드는 다른 아티스트/카테고리/앨범에서는 사용할 수 없습니다.'
            : barcodeError.message;
        console.error('inventory barcode update error', { step: 'update_items_barcode', error: barcodeError.message });
        return NextResponse.json(
          { error: message, step: 'update_items_barcode' },
          { status: barcodeError.code === '23505' ? 409 : 400 }
        );
      }
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

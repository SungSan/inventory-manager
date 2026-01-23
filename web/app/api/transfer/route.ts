import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';
import { findBarcodeConflict } from '../../../lib/barcode';

async function loadLocationScope(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_location_permissions')
    .select('primary_location, sub_locations')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function loadItemBarcode(params: {
  artist: string;
  category: string;
  album_version: string;
  option: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('items')
    .select('barcode')
    .eq('artist', params.artist)
    .eq('category', params.category)
    .eq('album_version', params.album_version)
    .eq('option', params.option)
    .maybeSingle();
  if (error) return null;
  return data?.barcode ?? null;
}

function normalizeOption(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized === '-' ? '' : normalized;
}

async function resolveItemId(params: {
  artist: string;
  category: string;
  album_version: string;
  option: string;
}) {
  const normalizedOption = normalizeOption(params.option);
  const { data, error } = await supabaseAdmin
    .from('items')
    .upsert(
      {
        artist: params.artist,
        category: params.category,
        album_version: params.album_version,
        option: normalizedOption,
      },
      { onConflict: 'artist,category,album_version,option' }
    )
    .select('id')
    .single();
  if (error || !data) {
    console.error('[transfer] item resolve failed', {
      error: error?.message,
      input: {
        artist: params.artist,
        category: params.category,
        album_version: params.album_version,
        option: normalizedOption,
      },
      query: 'items upsert on artist,category,album_version,option',
    });
    return null;
  }
  return data.id as string;
}

async function loadInventoryQuantity(itemId: string, location: string) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('quantity')
    .eq('item_id', itemId)
    .eq('location', location)
    .maybeSingle();
  if (error) {
    console.error('[transfer] inventory read failed', { error: error.message });
    return null;
  }
  if (!data) {
    const { error: insertError } = await supabaseAdmin
      .from('inventory')
      .insert({ item_id: itemId, location, quantity: 0 });
    if (insertError) {
      console.error('[transfer] inventory create failed', { error: insertError.message });
      return null;
    }
    return 0;
  }
  return Number(data.quantity ?? 0);
}

async function hasIdempotentMovement(key: string) {
  const { data, error } = await supabaseAdmin
    .from('movements')
    .select('id')
    .eq('idempotency_key', key)
    .maybeSingle();
  if (error) {
    console.error('[transfer] idempotency lookup failed', { error: error.message });
    return false;
  }
  return Boolean(data?.id);
}

async function recordMovement(params: {
  itemId: string;
  location: string;
  direction: 'IN' | 'OUT';
  quantity: number;
  memo: string;
  createdBy: string;
  idempotencyKey: string;
  fromLocation: string;
  toLocation: string;
}) {
  if (await hasIdempotentMovement(params.idempotencyKey)) {
    return { ok: true, idempotent: true };
  }

  const existingQty = await loadInventoryQuantity(params.itemId, params.location);
  if (existingQty === null) {
    return { ok: false, error: 'inventory lookup failed' };
  }

  const nextQty = params.direction === 'IN'
    ? existingQty + params.quantity
    : existingQty - params.quantity;

  const { error: invError } = await supabaseAdmin
    .from('inventory')
    .update({ quantity: nextQty, updated_at: new Date().toISOString() })
    .eq('item_id', params.itemId)
    .eq('location', params.location);

  if (invError) {
    console.error('[transfer] inventory update failed', { error: invError.message });
    return { ok: false, error: invError.message };
  }

  const { data: movement, error: moveError } = await supabaseAdmin
    .from('movements')
    .insert({
      item_id: params.itemId,
      location: params.location,
      direction: params.direction,
      quantity: params.quantity,
      memo: params.memo || null,
      created_by: params.createdBy,
      idempotency_key: params.idempotencyKey,
      opening: existingQty,
      closing: nextQty,
      from_location: params.fromLocation,
      to_location: params.toLocation,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (moveError) {
    console.error('[transfer] movement insert failed', { error: moveError.message });
    return { ok: false, error: moveError.message };
  }

  return { ok: true, movementId: movement?.id };
}

export async function POST(req: Request) {
  return withAuth(['admin', 'operator', 'l_operator', 'manager'], async (session) => {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      console.error({ step: 'parse_body', error });
      return NextResponse.json({ ok: false, error: 'invalid json body', step: 'parse_body' }, { status: 400 });
    }

    const {
      artist,
      category,
      album_version,
      option,
      fromLocation,
      toLocation,
      quantity,
      memo,
      barcode,
      idempotencyKey,
    } = body ?? {};

    const trimmedArtist = String(artist ?? '').trim();
    const trimmedAlbum = String(album_version ?? '').trim();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedOption = normalizeOption(option);
    const from_location = String(fromLocation ?? '').trim();
    const to_location = String(toLocation ?? '').trim();
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedQuantity = parseInt(quantity, 10);
    const normalizedBarcode = String(barcode ?? '').trim();

    if (!trimmedArtist || !normalizedCategory || !trimmedAlbum || !from_location || !to_location || !normalizedQuantity) {
      return NextResponse.json(
        { ok: false, error: 'missing fields', step: 'validation' },
        { status: 400 }
      );
    }

    if (!normalizedMemo) {
      return NextResponse.json(
        { ok: false, error: 'memo is required for transfer', step: 'validation' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      return NextResponse.json(
        { ok: false, error: 'quantity must be a positive number', step: 'validation' },
        { status: 400 }
      );
    }

    if (normalizedBarcode && (normalizedBarcode.length > 64 || /\s/.test(normalizedBarcode))) {
      return NextResponse.json(
        { ok: false, error: 'barcode must be 1~64 characters with no spaces', step: 'validation' },
        { status: 400 }
      );
    }

    const createdBy = session.userId ?? (session as any)?.user?.id ?? (session as any)?.user_id ?? null;
    if (!createdBy) {
      return NextResponse.json(
        { ok: false, error: 'missing created_by', step: 'validation' },
        { status: 401 }
      );
    }

    if (session.role === 'l_operator' || session.role === 'manager') {
      const scope = await loadLocationScope(createdBy);
      if (!scope?.primary_location) {
        return NextResponse.json(
          { ok: false, error: 'location scope missing', step: 'location_scope' },
          { status: 403 }
        );
      }
      if (from_location !== scope.primary_location) {
        return NextResponse.json(
          { ok: false, error: 'from_location not allowed', step: 'location_scope' },
          { status: 403 }
        );
      }
      const subs = Array.isArray(scope.sub_locations) ? scope.sub_locations.filter(Boolean) : [];
      if (!subs.includes(to_location)) {
        return NextResponse.json(
          { ok: false, error: 'to_location not allowed', step: 'location_scope' },
          { status: 403 }
        );
      }
    }

    if (normalizedBarcode && session.role !== 'admin') {
      const existingBarcode = await loadItemBarcode({
        artist: trimmedArtist,
        category: normalizedCategory,
        album_version: trimmedAlbum,
        option: normalizedOption,
      });
      if (existingBarcode && existingBarcode !== normalizedBarcode) {
        return NextResponse.json(
          { ok: false, error: 'barcode update not allowed', step: 'barcode_scope' },
          { status: 403 }
        );
      }
    }

    try {
      const itemId = await resolveItemId({
        artist: trimmedArtist,
        category: normalizedCategory,
        album_version: trimmedAlbum,
        option: normalizedOption,
      });
      if (!itemId) {
        return NextResponse.json(
          { ok: false, step: 'resolve_item', error: 'item resolve failed' },
          { status: 500 }
        );
      }

      if (normalizedBarcode) {
        const conflict = await findBarcodeConflict({
          client: supabaseAdmin,
          barcode: normalizedBarcode,
          itemId,
          artist: trimmedArtist,
          category: normalizedCategory,
          albumVersion: trimmedAlbum,
        });
        if (conflict) {
          return NextResponse.json(
            {
              ok: false,
              error: '같은 바코드가 다른 아티스트/카테고리/앨범버전에 이미 등록되어 저장할 수 없습니다.',
              conflict,
              step: 'update_items_barcode',
            },
            { status: 409 }
          );
        }
        const { error: barcodeError } = await supabaseAdmin
          .from('items')
          .update({ barcode: normalizedBarcode })
          .eq('id', itemId);
        if (barcodeError) {
          const message =
            barcodeError.code === '23505'
              ? '바코드가 다른 상품(아티스트/앨범)에서 사용 중입니다.'
              : barcodeError.message;
          console.error('transfer barcode update failed', { error: barcodeError.message, itemId });
          return NextResponse.json(
            { ok: false, step: 'update_items_barcode', error: message },
            { status: barcodeError.code === '23505' ? 409 : 500 }
          );
        }
      }

      const baseIdempotency = String(idempotencyKey ?? '').trim() || `transfer-${randomUUID()}`;
      const outResult = await recordMovement({
        itemId,
        location: from_location,
        direction: 'OUT',
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        createdBy,
        idempotencyKey: `${baseIdempotency}-out`,
        fromLocation: from_location,
        toLocation: to_location,
      });
      if (!outResult.ok) {
        return NextResponse.json(
          { ok: false, step: 'record_out', error: outResult.error ?? 'transfer failed' },
          { status: 500 }
        );
      }

      const inResult = await recordMovement({
        itemId,
        location: to_location,
        direction: 'IN',
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        createdBy,
        idempotencyKey: `${baseIdempotency}-in`,
        fromLocation: from_location,
        toLocation: to_location,
      });
      if (!inResult.ok) {
        return NextResponse.json(
          { ok: false, step: 'record_in', error: inResult.error ?? 'transfer failed' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, result: { out: outResult, in: inResult } });
    } catch (error: any) {
      console.error('transfer unexpected error', { error, from_location, to_location });
      return NextResponse.json(
        { ok: false, step: 'exception', error: error?.message || 'transfer failed' },
        { status: 500 }
      );
    }
  });
}

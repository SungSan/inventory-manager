import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuthMobile } from '../../../../lib/auth_mobile';
import { findBarcodeConflict } from '../../../../lib/barcode';
import type { Role } from '../../../../lib/session';

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

type ResolvedItem = {
  id: string;
  artist: string;
  category: string;
  album_version: string;
};

async function resolveItemId(params: {
  artist: string;
  category: string;
  album_version: string;
  option: string;
}): Promise<ResolvedItem | null> {
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
    .select('id, artist, category, album_version')
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
  return {
    id: data.id as string,
    artist: String(data.artist ?? ''),
    category: String(data.category ?? ''),
    album_version: String(data.album_version ?? ''),
  };
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

  const nextQty =
    params.direction === 'IN'
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

  return { ok: true, movementId: movement?.id, opening: existingQty, closing: nextQty };
}

export async function POST(req: Request) {
  const roles: Role[] = ['admin', 'operator', 'l_operator', 'manager'];
  return withAuthMobile(roles, req, async (session) => {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      console.error({ step: 'parse_body', error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const {
      artist,
      category,
      album_version,
      option,
      from_location,
      to_location,
      quantity,
      memo,
      barcode,
      idempotencyKey,
    } = body ?? {};

    const trimmedArtist = String(artist ?? '').trim();
    const trimmedAlbum = String(album_version ?? '').trim();
    const normalizedQuantity = parseInt(quantity, 10);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedOption = normalizeOption(option);
    const normalizedBarcode = String(barcode ?? '').trim();
    const fromLocation = String(from_location ?? '').trim();
    const toLocation = String(to_location ?? '').trim();

    if (!trimmedArtist || !normalizedCategory || !trimmedAlbum || !fromLocation || !toLocation) {
      const error = 'missing fields';
      console.error({ step: 'validation', error });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      const error = 'quantity must be a positive number';
      console.error({ step: 'validation', error, payload: { quantity } });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (!normalizedMemo) {
      const error = 'memo is required for transfer';
      console.error({ step: 'validation', error });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (normalizedBarcode && (normalizedBarcode.length > 64 || /\\s/.test(normalizedBarcode))) {
      return NextResponse.json(
        { ok: false, error: 'barcode must be 1~64 characters with no spaces', step: 'validation' },
        { status: 400 }
      );
    }

    const createdBy = session.userId ?? null;
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
      if (fromLocation !== scope.primary_location) {
        return NextResponse.json(
          { ok: false, error: 'from_location not allowed', step: 'location_scope' },
          { status: 403 }
        );
      }
      const subs = Array.isArray(scope.sub_locations) ? scope.sub_locations.filter(Boolean) : [];
      if (!subs.includes(toLocation)) {
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
      const item = await resolveItemId({
        artist: trimmedArtist,
        category: normalizedCategory,
        album_version: trimmedAlbum,
        option: normalizedOption,
      });
      if (!item) {
        return NextResponse.json(
          { ok: false, step: 'resolve_item', error: 'item resolve failed' },
          { status: 500 }
        );
      }

      if (normalizedBarcode) {
        const conflict = await findBarcodeConflict({
          client: supabaseAdmin,
          barcode: normalizedBarcode,
          itemId: item.id,
        });
        if (conflict) {
          return NextResponse.json(
            {
              ok: false,
              error: '동일 바코드는 다른 아티스트/카테고리/앨범에서는 사용할 수 없습니다.',
              conflict,
              step: 'update_items_barcode',
            },
            { status: 409 }
          );
        }
        const { error: barcodeError } = await supabaseAdmin
          .from('items')
          .update({ barcode: normalizedBarcode })
          .eq('id', item.id);
        if (barcodeError) {
          const message =
            barcodeError.code === '23505'
              ? '동일 바코드는 다른 아티스트/카테고리/앨범에서는 사용할 수 없습니다.'
              : barcodeError.message;
          console.error('transfer barcode update failed', { error: barcodeError.message, itemId: item.id });
          return NextResponse.json(
            { ok: false, step: 'update_items_barcode', error: message },
            { status: barcodeError.code === '23505' ? 409 : 500 }
          );
        }
      }

      const baseIdempotency = String(idempotencyKey ?? '').trim() || `transfer-${randomUUID()}`;
      const outResult = await recordMovement({
        itemId: item.id,
        location: fromLocation,
        direction: 'OUT',
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        createdBy,
        idempotencyKey: `${baseIdempotency}-out`,
        fromLocation,
        toLocation,
      });
      if (!outResult.ok) {
        return NextResponse.json(
          { ok: false, step: 'record_out', error: outResult.error ?? 'transfer failed' },
          { status: 500 }
        );
      }

      const inResult = await recordMovement({
        itemId: item.id,
        location: toLocation,
        direction: 'IN',
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        createdBy,
        idempotencyKey: `${baseIdempotency}-in`,
        fromLocation,
        toLocation,
      });
      if (!inResult.ok) {
        return NextResponse.json(
          { ok: false, step: 'record_in', error: inResult.error ?? 'transfer failed' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true });
    } catch (error: any) {
      console.error({ step: 'transfer_unexpected', payload: { artist: trimmedArtist, fromLocation, toLocation }, error });
      const message = error?.message || '전산 이관 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

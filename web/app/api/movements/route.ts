import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseProjectRef = (() => {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    return hostname.split('.')[0];
  } catch (error) {
    console.warn('[movements] unable to parse supabase project ref', { error: (error as any)?.message });
    return '';
  }
})();

let supabaseRefLogged = false;
function logSupabaseRef() {
  if (!supabaseRefLogged) {
    console.info('[movements] supabase project ref detected', { ref: supabaseProjectRef || 'unknown' });
    supabaseRefLogged = true;
  }
}

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

async function resolveItemId(params: {
  artist: string;
  category: string;
  album_version: string;
  option: string;
  barcode?: string | null;
}) {
  const { data, error } = await supabaseAdmin
    .from('items')
    .upsert(
      {
        artist: params.artist,
        category: params.category,
        album_version: params.album_version,
        option: params.option ?? '',
        barcode: params.barcode ?? null,
      },
      { onConflict: 'artist,category,album_version,option' }
    )
    .select('id')
    .single();
  if (error || !data) {
    console.error('[movements] item resolve failed', { error: error?.message });
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
    console.error('[movements] inventory read failed', { error: error.message });
    return null;
  }
  if (!data) {
    const { error: insertError } = await supabaseAdmin
      .from('inventory')
      .insert({ item_id: itemId, location, quantity: 0 });
    if (insertError) {
      console.error('[movements] inventory create failed', { error: insertError.message });
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
    console.error('[movements] idempotency lookup failed', { error: error.message });
    return false;
  }
  return Boolean(data?.id);
}

async function recordMovement(params: {
  itemId: string;
  location: string;
  direction: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  memo: string;
  createdBy: string;
  idempotencyKey: string;
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
      : params.direction === 'OUT'
      ? existingQty - params.quantity
      : params.quantity;

  const { error: invError } = await supabaseAdmin
    .from('inventory')
    .update({ quantity: nextQty, updated_at: new Date().toISOString() })
    .eq('item_id', params.itemId)
    .eq('location', params.location);

  if (invError) {
    console.error('[movements] inventory update failed', { error: invError.message });
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
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (moveError) {
    console.error('[movements] movement insert failed', { error: moveError.message });
    return { ok: false, error: moveError.message };
  }

  return { ok: true, movementId: movement?.id, opening: existingQty, closing: nextQty };
}

async function hasBarcodeConflict(barcode: string, artist: string, category: string, albumVersion: string) {
  const { data, error } = await supabaseAdmin
    .from('items')
    .select('artist, category, album_version')
    .eq('barcode', barcode);
  if (error) {
    console.error('[movements] barcode lookup failed', { error: error.message });
    return false;
  }
  return (data ?? []).some(
    (row) =>
      row.artist !== artist ||
      row.category !== category ||
      row.album_version !== albumVersion
  );
}

export async function POST(req: Request) {
  return withAuth(['admin', 'operator', 'l_operator', 'manager'], async (session) => {
    logSupabaseRef();
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
      location,
      quantity,
      direction,
      memo,
      barcode,
      idempotencyKey,
      idempotency_key
    } = body ?? {};

    const trimmedArtist = String(artist ?? '').trim();
    const trimmedAlbum = String(album_version ?? '').trim();
    const normalizedQuantity = parseInt(quantity, 10);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedDirection = String(direction ?? '').toUpperCase();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedOption = String(option ?? '').trim();
    const normalizedBarcode = String(barcode ?? '').trim();
    const rawLocation = String(location ?? '').trim();
    const effectiveLocation = rawLocation || normalizedOption;

    if (!trimmedArtist || !normalizedCategory || !trimmedAlbum || (!effectiveLocation && normalizedDirection !== 'TRANSFER') || !normalizedDirection) {
      const error = 'missing fields';
      console.error({
        step: 'validation',
        error,
        payload: {
          artist: trimmedArtist,
          category: normalizedCategory,
          album_version: trimmedAlbum,
          location: effectiveLocation,
          direction: normalizedDirection
        }
      });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      const error = 'quantity must be a positive number';
      console.error({ step: 'validation', error, payload: { quantity } });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (normalizedBarcode && (normalizedBarcode.length > 64 || /\s/.test(normalizedBarcode))) {
      return NextResponse.json(
        { ok: false, error: 'barcode must be 1~64 characters with no spaces', step: 'validation' },
        { status: 400 }
      );
    }

    if (!['IN', 'OUT'].includes(normalizedDirection)) {
      const error = 'direction must be IN or OUT';
      console.error({ step: 'validation', error, payload: { direction } });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    if (normalizedDirection === 'OUT' && !normalizedMemo) {
      const error = 'memo is required for outbound movements';
      console.error({ step: 'validation', error });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    const idempotencyRaw = idempotency_key ?? idempotencyKey ?? randomUUID();
    const idempotency = idempotencyRaw ? String(idempotencyRaw).trim() : randomUUID();
    const createdBy = session.userId ?? (session as any)?.user?.id ?? (session as any)?.user_id ?? null;

    if (!createdBy) {
      return NextResponse.json(
        { ok: false, step: 'validation', error: 'missing created_by' },
        { status: 401 }
      );
    }
    const scope = session.role === 'l_operator' || session.role === 'manager' ? await loadLocationScope(createdBy) : null;
    if (session.role === 'l_operator' || session.role === 'manager') {
      const primaryLocation = String(scope?.primary_location ?? '').trim();
      const subLocations = Array.isArray(scope?.sub_locations)
        ? scope?.sub_locations.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];
      const allowedLocations = Array.from(new Set([primaryLocation, ...subLocations].filter(Boolean)));

      if (allowedLocations.length === 0) {
        return NextResponse.json({ ok: false, error: 'location scope missing', step: 'location_scope' }, { status: 403 });
      }
      if (!allowedLocations.includes(effectiveLocation)) {
        return NextResponse.json({ ok: false, error: 'location not allowed', step: 'location_scope' }, { status: 403 });
      }
    }

    if (
      normalizedBarcode &&
      (await hasBarcodeConflict(normalizedBarcode, trimmedArtist, normalizedCategory, trimmedAlbum))
    ) {
      return NextResponse.json(
        { ok: false, error: 'barcode already used by another item', step: 'barcode_scope' },
        { status: 409 }
      );
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
        barcode: normalizedBarcode || null,
      });
      if (!itemId) {
        return NextResponse.json(
          { ok: false, error: 'item resolve failed', step: 'resolve_item' },
          { status: 500 }
        );
      }

      const result = await recordMovement({
        itemId,
        location: effectiveLocation,
        direction: normalizedDirection as 'IN' | 'OUT' | 'ADJUST',
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        createdBy,
        idempotencyKey: idempotency,
      });

      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? 'movement failed', step: 'movement_write' },
          { status: 500 }
        );
      }

      let barcodeUpdateError: string | null = null;
      if (normalizedBarcode) {
        const { error: barcodeError } = await supabaseAdmin
          .from('items')
          .update({ barcode: normalizedBarcode })
          .eq('id', itemId);
        if (barcodeError) {
          barcodeUpdateError = barcodeError.message;
          console.error('barcode update failed', { barcodeError, itemId });
        }
      }
      return NextResponse.json({ ok: true, result, barcodeUpdateError });
    } catch (error: any) {
      console.error({ step: 'movement_unexpected', payload: { artist: trimmedArtist, location: effectiveLocation }, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

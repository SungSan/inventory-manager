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

    const payload: Record<string, any> = {
      album_version: trimmedAlbum,
      artist: trimmedArtist,
      category: normalizedCategory,
      created_by: createdBy,
      direction: normalizedDirection,
      idempotency_key: idempotency,
      memo: normalizedMemo,
      option: normalizedOption || '',
      quantity: normalizedQuantity,
    };

    payload.location = effectiveLocation;

    try {
      const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
      if (error) {
        console.error(`record_movement rpc failed:`, {
          message: error.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
          payload
        });
        return NextResponse.json(
          {
            ok: false,
            step: `record_movement_rpc`,
            error: error.message,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            code: (error as any)?.code ?? null
          },
          { status: 500 }
        );
      }

      if (!data) {
        console.error({ step: `record_movement_rpc`, error: 'empty response', payload });
        return NextResponse.json(
          { ok: false, step: `record_movement_rpc`, error: 'empty response from rpc' },
          { status: 500 }
        );
      }

      const result = data as any;
      let barcodeUpdateError: string | null = null;
      if (normalizedBarcode && result?.item_id) {
        const { error: barcodeError } = await supabaseAdmin
          .from('items')
          .update({ barcode: normalizedBarcode })
          .eq('id', result.item_id);
        if (barcodeError) {
          barcodeUpdateError = barcodeError.message;
          console.error('barcode update failed', { barcodeError, itemId: result.item_id });
        }
      }
      return NextResponse.json({ ok: true, result, barcodeUpdateError });
    } catch (error: any) {
      console.error({ step: 'record_movement_unexpected', payload, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';

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

export async function POST(req: Request) {
  return withAuth(['admin', 'operator', 'l_operator'], async (session) => {
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
    const normalizedOption = String(option ?? '').trim();
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

    if (session.role === 'l_operator') {
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

    const baseIdempotency = String(idempotencyKey ?? '').trim() || `transfer-${randomUUID()}`;
    const outPayload: Record<string, any> = {
      album_version: trimmedAlbum,
      artist: trimmedArtist,
      category: normalizedCategory,
      created_by: createdBy,
      direction: 'OUT',
      idempotency_key: `${baseIdempotency}-out`,
      location: from_location,
      memo: normalizedMemo,
      option: normalizedOption || '',
      quantity: normalizedQuantity,
    };

    const inPayload: Record<string, any> = {
      album_version: trimmedAlbum,
      artist: trimmedArtist,
      category: normalizedCategory,
      created_by: createdBy,
      direction: 'IN',
      idempotency_key: `${baseIdempotency}-in`,
      location: to_location,
      memo: normalizedMemo,
      option: normalizedOption || '',
      quantity: normalizedQuantity,
    };

    if (normalizedBarcode) {
      outPayload.barcode = normalizedBarcode;
      inPayload.barcode = normalizedBarcode;
    }

    try {
      const { data: outData, error: outError } = await supabaseAdmin.rpc('record_movement', outPayload);
      if (outError) {
        console.error('transfer record_movement OUT failed', {
          message: outError.message,
          details: (outError as any)?.details,
          hint: (outError as any)?.hint,
          code: (outError as any)?.code,
          payload: outPayload,
        });
        return NextResponse.json(
          {
            ok: false,
            step: 'record_movement_out',
            error: outError.message,
            details: (outError as any)?.details ?? null,
            hint: (outError as any)?.hint ?? null,
            code: (outError as any)?.code ?? null,
          },
          { status: 500 }
        );
      }

      const { data: inData, error: inError } = await supabaseAdmin.rpc('record_movement', inPayload);
      if (inError) {
        console.error('transfer record_movement IN failed', {
          message: inError.message,
          details: (inError as any)?.details,
          hint: (inError as any)?.hint,
          code: (inError as any)?.code ?? null,
          payload: inPayload,
        });
        return NextResponse.json(
          {
            ok: false,
            step: 'record_movement_in',
            error: inError.message,
            details: (inError as any)?.details ?? null,
            hint: (inError as any)?.hint ?? null,
            code: (inError as any)?.code ?? null,
          },
          { status: 500 }
        );
      }

      if (!outData || !inData) {
        return NextResponse.json(
          { ok: false, step: 'record_movement', error: 'empty response from rpc' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, result: { out: outData, in: inData } });
    } catch (error: any) {
      console.error('transfer unexpected error', { error, outPayload, inPayload });
      return NextResponse.json(
        { ok: false, step: 'exception', error: error?.message || 'transfer failed' },
        { status: 500 }
      );
    }
  });
}

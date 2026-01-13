import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

type BulkTransferItem = {
  artist: string;
  category: string;
  album_version: string;
  option?: string;
  from_location: string;
  quantity: number;
  barcode?: string;
  item_id?: string | null;
};

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

    const toLocation = String(body?.to_location ?? '').trim();
    const memo = String(body?.memo ?? '').trim();
    const items = Array.isArray(body?.items) ? (body.items as BulkTransferItem[]) : [];
    if (!toLocation || items.length === 0) {
      return NextResponse.json({ ok: false, error: 'missing fields', step: 'validation' }, { status: 400 });
    }
    if (!memo) {
      return NextResponse.json({ ok: false, error: 'memo is required for bulk transfer', step: 'validation' }, { status: 400 });
    }

    const createdBy = session.userId ?? (session as any)?.user?.id ?? (session as any)?.user_id ?? null;
    if (!createdBy) {
      return NextResponse.json({ ok: false, error: 'missing created_by', step: 'validation' }, { status: 401 });
    }

    let primaryLocation: string | null = null;
    if (session.role === 'l_operator') {
      const scope = await loadLocationScope(createdBy);
      if (!scope?.primary_location) {
        return NextResponse.json(
          { ok: false, error: 'location scope missing', step: 'location_scope' },
          { status: 403 }
        );
      }
      primaryLocation = scope.primary_location;
      const subs = Array.isArray(scope.sub_locations) ? scope.sub_locations.filter(Boolean) : [];
      if (!subs.includes(toLocation)) {
        return NextResponse.json(
          { ok: false, error: 'to_location not allowed', step: 'location_scope' },
          { status: 403 }
        );
      }
    }

    const baseIdempotency = String(body?.idempotencyKey ?? '').trim() || `bulk-transfer-${randomUUID()}`;
    const successes: Array<{ item: BulkTransferItem; result: { out: any; in: any } }> = [];
    const failures: Array<{ item: BulkTransferItem; step: string; error: string }> = [];

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const trimmedArtist = String(item?.artist ?? '').trim();
      const trimmedAlbum = String(item?.album_version ?? '').trim();
      const normalizedCategory = String(item?.category ?? '').trim();
      const normalizedOption = String(item?.option ?? '').trim();
      const from_location = String(item?.from_location ?? '').trim();
      const normalizedQuantity = parseInt(String(item?.quantity ?? ''), 10);
      const normalizedBarcode = String(item?.barcode ?? '').trim();

      if (!trimmedArtist || !trimmedAlbum || !normalizedCategory || !from_location || !normalizedQuantity) {
        failures.push({ item, step: 'validation', error: 'missing fields' });
        continue;
      }

      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
        failures.push({ item, step: 'validation', error: 'quantity must be a positive number' });
        continue;
      }

      if (normalizedBarcode && (normalizedBarcode.length > 64 || /\s/.test(normalizedBarcode))) {
        failures.push({ item, step: 'validation', error: 'barcode must be 1~64 characters with no spaces' });
        continue;
      }

      if (session.role === 'l_operator' && primaryLocation && from_location !== primaryLocation) {
        failures.push({ item, step: 'location_scope', error: 'from_location not allowed' });
        continue;
      }

      if (normalizedBarcode && session.role !== 'admin') {
        const existingBarcode = await loadItemBarcode({
          artist: trimmedArtist,
          category: normalizedCategory,
          album_version: trimmedAlbum,
          option: normalizedOption,
        });
        if (existingBarcode && existingBarcode !== normalizedBarcode) {
          failures.push({ item, step: 'barcode_scope', error: 'barcode update not allowed' });
          continue;
        }
      }

      const itemIdempotency = `${baseIdempotency}-${idx}`;
      const outPayload: Record<string, any> = {
        album_version: trimmedAlbum,
        artist: trimmedArtist,
        barcode: normalizedBarcode || '',
        category: normalizedCategory,
        created_by: createdBy,
        direction: 'OUT',
        idempotency_key: `${itemIdempotency}-out`,
        location: from_location,
        memo,
        option: normalizedOption || '',
        quantity: normalizedQuantity,
      };

      const inPayload: Record<string, any> = {
        album_version: trimmedAlbum,
        artist: trimmedArtist,
        barcode: normalizedBarcode || '',
        category: normalizedCategory,
        created_by: createdBy,
        direction: 'IN',
        idempotency_key: `${itemIdempotency}-in`,
        location: toLocation,
        memo,
        option: normalizedOption || '',
        quantity: normalizedQuantity,
      };

      try {
        const { data: outData, error: outError } = await supabaseAdmin.rpc('record_movement', outPayload);
        if (outError) {
          console.error('bulk transfer record_movement OUT failed', {
            message: outError.message,
            details: (outError as any)?.details,
            hint: (outError as any)?.hint,
            code: (outError as any)?.code,
            payload: outPayload,
          });
          failures.push({ item, step: 'record_movement_out', error: outError.message });
          continue;
        }

        const { data: inData, error: inError } = await supabaseAdmin.rpc('record_movement', inPayload);
        if (inError) {
          console.error('bulk transfer record_movement IN failed', {
            message: inError.message,
            details: (inError as any)?.details,
            hint: (inError as any)?.hint,
            code: (inError as any)?.code,
            payload: inPayload,
          });
          failures.push({ item, step: 'record_movement_in', error: inError.message });
          continue;
        }

        if (!outData || !inData) {
          failures.push({ item, step: 'record_movement', error: 'empty response from rpc' });
          continue;
        }

        successes.push({ item, result: { out: outData, in: inData } });
      } catch (error: any) {
        console.error('bulk transfer unexpected error', { error, item });
        failures.push({ item, step: 'exception', error: error?.message || 'transfer failed' });
      }
    }

    return NextResponse.json({
      ok: failures.length === 0,
      results: { successes, failures },
    });
  });
}

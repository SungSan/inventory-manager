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

export async function POST(req: Request) {
  return withAuth(['admin', 'operator', 'l_operator'], async (session) => {
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
      idempotency_key,
    } = body ?? {};

    const trimmedArtist = String(artist ?? '').trim();
    const trimmedAlbum = String(album_version ?? '').trim();
    const normalizedQuantity = parseInt(quantity, 10);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedOption = String(option ?? '').trim();
    const fromLocation = String(from_location ?? '').trim();
    const toLocation = String(to_location ?? '').trim();
    const normalizedBarcode = String(barcode ?? '').trim() || null;

    if (!trimmedArtist || !normalizedCategory || !trimmedAlbum || !fromLocation || !toLocation) {
      return NextResponse.json({ ok: false, error: 'missing fields', step: 'validation' }, { status: 400 });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      return NextResponse.json({ ok: false, error: 'quantity must be a positive number', step: 'validation' }, { status: 400 });
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

    const scope = session.role === 'l_operator' ? await loadLocationScope(createdBy) : null;
    if (session.role === 'l_operator') {
      if (!scope?.primary_location) {
        return NextResponse.json({ ok: false, error: 'location scope missing', step: 'location_scope' }, { status: 403 });
      }
      if (fromLocation !== scope.primary_location || (scope.sub_locations || []).indexOf(toLocation) === -1) {
        return NextResponse.json({ ok: false, error: 'transfer not allowed for this location', step: 'location_scope' }, { status: 403 });
      }
    }

    const payload: Record<string, any> = {
      album_version: trimmedAlbum,
      artist: trimmedArtist,
      category: normalizedCategory,
      created_by: createdBy,
      direction: 'TRANSFER',
      idempotency_key: idempotency,
      memo: normalizedMemo,
      option: normalizedOption || '',
      quantity: normalizedQuantity,
      barcode: normalizedBarcode,
      from_location: fromLocation,
      to_location: toLocation,
    };

    try {
      const { data, error } = await supabaseAdmin.rpc('record_transfer', payload);
      if (error) {
        console.error('record_transfer rpc failed:', {
          message: error.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
          payload,
        });
        return NextResponse.json(
          {
            ok: false,
            step: 'record_transfer_rpc',
            error: error.message,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            code: (error as any)?.code ?? null,
          },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { ok: false, step: 'record_transfer_rpc', error: 'empty response from rpc' },
          { status: 500 }
        );
      }

      const result = data as any;
      return NextResponse.json({ ok: true, result });
    } catch (error: any) {
      console.error({ step: 'record_transfer_unexpected', payload, error });
      const message = error?.message || '전산이관 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

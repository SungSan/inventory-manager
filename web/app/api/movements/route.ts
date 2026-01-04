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

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
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
    const rawLocation = String(location ?? '').trim();
    const effectiveLocation = rawLocation || normalizedOption;

    if (!trimmedArtist || !normalizedCategory || !trimmedAlbum || !effectiveLocation || !normalizedDirection) {
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

    if (normalizedDirection !== 'IN' && normalizedDirection !== 'OUT') {
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
    const payload = {
      album_version: trimmedAlbum,
      artist: trimmedArtist,
      category: normalizedCategory,
      created_by: createdBy,
      direction: normalizedDirection,
      idempotency_key: idempotency,
      location: effectiveLocation,
      memo: normalizedMemo,
      option: normalizedOption || '',
      quantity: normalizedQuantity
    };

    try {
      const { data, error } = await supabaseAdmin.rpc('record_movement_v2', payload);
      if (error) {
        console.error('record_movement rpc failed:', {
          message: error.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
          payload
        });
        return NextResponse.json(
          {
            ok: false,
            step: 'record_movement_rpc',
            error: error.message,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            code: (error as any)?.code ?? null
          },
          { status: 500 }
        );
      }

      if (!data) {
        console.error({ step: 'record_movement_rpc', error: 'empty response', payload });
        return NextResponse.json(
          { ok: false, step: 'record_movement_rpc', error: 'empty response from record_movement' },
          { status: 500 }
        );
      }

      const result = data as any;
      return NextResponse.json({ ok: true, result });
    } catch (error: any) {
      console.error({ step: 'record_movement_unexpected', payload, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

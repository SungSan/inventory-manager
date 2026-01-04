import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
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
    const effectiveLocation = String(location ?? '').trim();
    const normalizedQuantity = Number(quantity);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedDirection = String(direction ?? '').toUpperCase();
    const normalizedCategory = String(category ?? '').trim();
    const normalizedOption = String(option ?? '').trim();

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

    if (normalizedDirection === 'OUT' && !normalizedMemo) {
      const error = 'memo is required for outbound movements';
      console.error({ step: 'validation', error });
      return NextResponse.json({ ok: false, error, step: 'validation' }, { status: 400 });
    }

    const idempotencyRaw = idempotency_key ?? idempotencyKey ?? randomUUID();
    const idempotency = idempotencyRaw ? String(idempotencyRaw).trim() : randomUUID();
    const payload = {
      p_artist: trimmedArtist,
      p_category: normalizedCategory,
      p_album_version: trimmedAlbum,
      p_option: normalizedOption,
      p_location: effectiveLocation,
      p_quantity: normalizedQuantity,
      p_direction: normalizedDirection,
      p_memo: normalizedMemo,
      p_created_by: session.userId,
      p_idempotency_key: idempotency
    };

    try {
      const { data, error } = await supabaseAdmin.rpc('apply_movement', payload);
      if (error) {
        console.error('apply_movement rpc failed:', {
          message: error.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
          payload
        });
        return NextResponse.json(
          {
            ok: false,
            step: 'apply_movement_rpc',
            error: error.message,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            code: (error as any)?.code ?? null
          },
          { status: 500 }
        );
      }

      const result = (data as any) || {};
      const ok = result.ok === true;
      const duplicated = result.duplicated === true;

      if (!ok) {
        const message = result.message || '입출고 처리 결과가 반영되지 않았습니다.';
        console.error({ step: 'apply_movement_result_invalid', payload, result });
        return NextResponse.json(
          { ok: false, step: 'apply_movement_result', error: message },
          { status: 500 }
        );
      }

      if (duplicated) {
        return NextResponse.json({
          ok: true,
          duplicated: true,
          movement_inserted: false,
          inventory_updated: false,
          movement_id: result.movement_id ?? null,
          item_id: result.item_id ?? null,
          inventory_quantity: result.inventory_quantity ?? null,
          message: result.message ?? 'duplicate request ignored'
        });
      }

      return NextResponse.json({
        ok: true,
        duplicated: false,
        movement_inserted: true,
        inventory_updated: true,
        movement_id: result.movement_id ?? null,
        item_id: result.item_id ?? null,
        inventory_quantity: result.inventory_quantity ?? null,
        message: result.message ?? 'ok'
      });
    } catch (error: any) {
      console.error({ step: 'apply_movement_unexpected', payload, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message, step: 'exception' }, { status: 500 });
    }
  });
}

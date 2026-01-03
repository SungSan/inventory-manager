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
    const effectiveLocation = String(location ?? '').trim() || String(option ?? '').trim();
    const normalizedQuantity = Number(quantity);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedDirection = String(direction ?? '').toUpperCase();

    if (!trimmedArtist || !category || !trimmedAlbum || !effectiveLocation || !normalizedDirection) {
      const error = 'missing fields';
      console.error({
        step: 'validation',
        error,
        payload: {
          artist: trimmedArtist,
          category,
          album_version: trimmedAlbum,
          location: effectiveLocation,
          direction: normalizedDirection
        }
      });
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      const error = 'quantity must be a positive number';
      console.error({ step: 'validation', error, payload: { quantity } });
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    if (normalizedDirection === 'OUT' && !normalizedMemo) {
      const error = 'memo is required for outbound movements';
      console.error({ step: 'validation', error });
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    const idempotencyRaw = idempotency_key ?? idempotencyKey ?? null;
    const idempotency = idempotencyRaw ? String(idempotencyRaw).trim() : null;
    const payload = {
      artist: trimmedArtist,
      category,
      album_version: trimmedAlbum,
      option: String(option ?? '').trim() || '',
      location: effectiveLocation,
      quantity: normalizedQuantity,
      direction: normalizedDirection,
      memo: normalizedMemo,
      created_by: session.userId,
      idempotency_key: idempotency || null
    };

    try {
      const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
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
          { status: 400 }
        );
      }

      const result = (data as any) || {};
      const idempotent = result.idempotent === true;
      const hasFlags = 'movement_inserted' in result || 'inventory_updated' in result;
      const movementInserted = result.movement_inserted === true;
      const inventoryUpdated = result.inventory_updated === true;

      if (idempotent) {
        return NextResponse.json({
          ok: true,
          idempotent: true,
          movement_inserted: false,
          inventory_updated: false,
          message: result.message ?? 'idempotent'
        });
      }

      if (result.ok === true && !hasFlags) {
        return NextResponse.json({ ok: true, idempotent: false, message: result.message ?? 'ok' });
      }

      if (movementInserted && inventoryUpdated) {
        return NextResponse.json({
          ok: true,
          idempotent: false,
          movement_inserted: true,
          inventory_updated: true,
          opening: result.opening,
          closing: result.closing,
          item_id: result.item_id,
          movement_id: result.movement_id,
          message: result.message ?? 'ok'
        });
      }

      const message = result.message || '입출고 처리 결과가 반영되지 않았습니다.';
      console.error({ step: 'movement_result_incomplete', payload, result });
      return NextResponse.json(
        {
          ok: false,
          idempotent,
          movement_inserted: movementInserted,
          inventory_updated: inventoryUpdated,
          error: message
        },
        { status: 400 }
      );
    } catch (error: any) {
      console.error({ step: 'record_movement_unexpected', payload, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  });
}

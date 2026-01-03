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
    const trimmedLocation = String(location ?? '').trim();
    const normalizedQuantity = Number(quantity);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedDirection = String(direction ?? '').toUpperCase();

    if (!trimmedArtist || !category || !trimmedAlbum || !trimmedLocation || !normalizedDirection) {
      const error = 'missing fields';
      console.error({ step: 'validation', error, payload: { artist: trimmedArtist, category, album_version: trimmedAlbum, location: trimmedLocation, direction: normalizedDirection } });
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

    const idempotency = idempotency_key ?? idempotencyKey ?? null;
    const payload = {
      artist: trimmedArtist,
      category,
      album_version: trimmedAlbum,
      option: option || '',
      location: trimmedLocation,
      quantity: normalizedQuantity,
      direction: normalizedDirection,
      memo: normalizedMemo,
      created_by: session.userId,
      idempotency_key: idempotency || null
    };

    try {
      const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
      if (error) {
        console.error({ step: 'record_movement_rpc', payload, error });
        return NextResponse.json({ ok: false, step: 'record_movement_rpc', error: error.message }, { status: 500 });
      }

      const result = (data as any) || {};
      const movementInserted = result.movement_inserted === true;
      const inventoryUpdated = result.inventory_updated === true;
      const idempotent = result.idempotent === true;

      if (!movementInserted || !inventoryUpdated) {
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
          { status: idempotent ? 409 : 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        idempotent,
        movement_inserted: movementInserted,
        inventory_updated: inventoryUpdated,
        opening: result.opening,
        closing: result.closing,
        item_id: result.item_id,
        movement_id: result.movement_id
      });
    } catch (error: any) {
      console.error({ step: 'record_movement_unexpected', payload, error });
      const message = error?.message || '입출고 처리 중 오류가 발생했습니다.';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  });
}

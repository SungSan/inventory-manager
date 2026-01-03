import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
    const body = await req.json();
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
    } = body;
    const trimmedArtist = String(artist ?? '').trim();
    const trimmedAlbum = String(album_version ?? '').trim();
    const trimmedLocation = String(location ?? '').trim();
    const normalizedQuantity = Number(quantity);
    const normalizedMemo = String(memo ?? '').trim();
    const normalizedDirection = String(direction ?? '').toUpperCase();

    if (!trimmedArtist || !category || !trimmedAlbum || !trimmedLocation || !normalizedDirection) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 });
    }

    if (normalizedDirection === 'OUT' && !normalizedMemo) {
      return NextResponse.json({ error: 'memo is required for outbound movements' }, { status: 400 });
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

    const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
    if (error) {
      console.error('record_movement rpc error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result: data });
  });
}

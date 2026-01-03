import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';
import { ensureIdempotent } from '../../../lib/idempotency';

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
    if (idempotency) await ensureIdempotent(idempotency, session.userId!);
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

    const { error } = await supabaseAdmin.rpc('record_movement', payload);
    if (error) {
      console.error('record_movement rpc error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: existingMovement, error: existingError } = await supabaseAdmin
      .from('movements')
      .select('id')
      .eq('idempotency_key', idempotency || '')
      .maybeSingle();

    if (existingError) {
      console.error('movement lookup error:', existingError);
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingMovement) {
      const { data: itemRow, error: itemError } = await supabaseAdmin
        .from('items')
        .select('id')
        .eq('artist', trimmedArtist)
        .eq('category', category)
        .eq('album_version', trimmedAlbum)
        .eq('option', option || '')
        .maybeSingle();

      if (itemError || !itemRow?.id) {
        console.error('item lookup failed:', itemError);
        return NextResponse.json({ error: itemError?.message || 'item not found' }, { status: 500 });
      }

      const { error: insertError } = await supabaseAdmin.from('movements').insert({
        item_id: itemRow.id,
        location: trimmedLocation,
        direction: normalizedDirection,
        quantity: normalizedQuantity,
        memo: normalizedMemo,
        created_by: session.userId,
        idempotency_key: idempotency || null
      });

      if (insertError) {
        console.error('movement insert error:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  });
}

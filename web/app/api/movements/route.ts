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
    if (!artist || !category || !album_version || !location || !quantity || !direction) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }
    const idempotency = idempotency_key ?? idempotencyKey ?? null;
    if (idempotency) await ensureIdempotent(idempotency, session.userId!);
    const payload = {
      artist,
      category,
      album_version,
      option: option || '',
      location,
      quantity: Number(quantity),
      direction,
      memo: memo || '',
      created_by: session.userId,
      idempotency_key: idempotency || null
    };

    const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data || { ok: true });
  });
}

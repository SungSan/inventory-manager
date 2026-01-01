import { NextResponse } from 'next/server';
import { withAuth } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabase';
import { ensureIdempotent } from '../../../lib/idempotency';

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
    const body = await req.json();
    const { artist, category, album_version, option, location, quantity, direction, memo, idempotencyKey } = body;
    if (!artist || !category || !album_version || !location || !quantity || !direction) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }
    if (idempotencyKey) await ensureIdempotent(idempotencyKey, session.userId!);
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
      idempotency_key: idempotencyKey || null
    };

    const { data, error } = await supabaseAdmin.rpc('record_movement', payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data || { ok: true });
  });
}

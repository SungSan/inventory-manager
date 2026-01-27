import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type SetQuantityPayload = {
  item_id?: string;
  location?: string;
  new_quantity?: number;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async () => {
    let body: SetQuantityPayload;
    try {
      body = (await req.json()) as SetQuantityPayload;
    } catch (error) {
      console.error('[location-set-quantity] invalid json', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const itemId = String(body.item_id ?? '').trim();
    const location = String(body.location ?? '').trim();
    const newQuantity = Number(body.new_quantity);

    if (!itemId || !location || !Number.isFinite(newQuantity)) {
      return NextResponse.json({ ok: false, error: 'missing or invalid fields' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('inventory')
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq('item_id', itemId)
      .eq('location', location);

    if (error) {
      console.error('[location-set-quantity] failed', { error: error.message, itemId, location });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  });
}

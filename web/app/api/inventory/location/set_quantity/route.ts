import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type SetQuantityPayload = {
  itemId?: string;
  location?: string;
  newQuantity?: number;
  memo?: string;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
    let body: SetQuantityPayload;
    try {
      body = (await req.json()) as SetQuantityPayload;
    } catch (error) {
      console.error('[location-set-quantity] invalid json', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const itemId = String(body.itemId ?? '').trim();
    const location = String(body.location ?? '').trim();
    const newQuantity = Number(body.newQuantity);
    const memo = String(body.memo ?? 'location_edit:adjust_set').trim() || 'location_edit:adjust_set';

    if (!itemId || !location || !Number.isFinite(newQuantity)) {
      return NextResponse.json({ ok: false, error: 'missing or invalid fields' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc('inventory_location_adjust_set', {
      p_created_by: session.userId ?? null,
      p_item_id: itemId,
      p_location: location,
      p_memo: memo,
      p_new_quantity: newQuantity,
    });

    if (error) {
      console.error('[location-set-quantity] failed', { error: error.message, itemId, location });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  });
}

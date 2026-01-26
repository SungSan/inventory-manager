import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type AdjustPayload = {
  item_id?: string;
  location?: string;
  quantity?: number;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
    let body: AdjustPayload;
    try {
      body = (await req.json()) as AdjustPayload;
    } catch (error) {
      console.error('[location-adjust] invalid json', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const itemId = String(body.item_id ?? '').trim();
    const location = String(body.location ?? '').trim();
    const quantity = Number(body.quantity);

    if (!itemId || !location || !Number.isFinite(quantity)) {
      return NextResponse.json({ ok: false, error: 'missing or invalid fields' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('inventory_location_adjust', {
      p_item_id: itemId,
      p_location: location,
      p_quantity: quantity,
      p_created_by: session.userId ?? null,
      p_memo: 'location_edit:adjust',
    });

    if (error) {
      console.error('[location-adjust] failed', { error: error.message, itemId, location });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result: data });
  });
}

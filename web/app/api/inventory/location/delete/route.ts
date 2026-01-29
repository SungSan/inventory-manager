import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type DeletePayload = {
  item_id?: string;
  location?: string;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
    let body: DeletePayload;
    try {
      body = (await req.json()) as DeletePayload;
    } catch (error) {
      console.error('[location-delete] invalid json', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const itemId = String(body.item_id ?? '').trim();
    const location = String(body.location ?? '').trim();

    if (!itemId || !location) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('inventory_location_delete', {
      p_item_id: itemId,
      p_location: location,
      p_created_by: session.userId ?? null,
      p_memo: 'location_edit:delete',
    });

    if (error) {
      console.error('[location-delete] failed', { error: error.message, itemId, location });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (data?.blocked) {
      return NextResponse.json(
        { ok: false, blocked: true, quantity: data.quantity ?? null, error: 'quantity remaining' },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, result: data });
  });
}

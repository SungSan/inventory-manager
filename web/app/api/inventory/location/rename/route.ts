import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type RenamePayload = {
  itemId?: string;
  fromLocation?: string;
  toLocation?: string;
  merge?: boolean;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (_session) => {
    let body: RenamePayload;
    try {
      body = (await req.json()) as RenamePayload;
    } catch (error) {
      console.error('[location-rename] invalid json', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const itemId = String(body.itemId ?? '').trim();
    const fromLocation = String(body.fromLocation ?? '').trim();
    const toLocation = String(body.toLocation ?? '').trim();
    const merge = Boolean(body.merge);
    if (!itemId || !fromLocation || !toLocation) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc('inventory_location_rename', {
      p_from_location: fromLocation,
      p_item_id: itemId,
      p_merge: merge,
      p_to_location: toLocation,
    });

    if (error) {
      console.error('[location-rename] failed', { error: error.message, itemId, fromLocation, toLocation });
      const status = error.message.includes('merge required') ? 409 : 400;
      return NextResponse.json(
        { ok: false, error: error.message, merge_required: status === 409 },
        { status }
      );
    }

    return NextResponse.json({ ok: true });
  });
}

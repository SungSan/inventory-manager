import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type RenamePayload = {
  item_id?: string;
  from_location?: string;
  to_location?: string;
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

    const itemId = String(body.item_id ?? '').trim();
    const fromLocation = String(body.from_location ?? '').trim();
    const toLocation = String(body.to_location ?? '').trim();
    const merge = Boolean(body.merge);

    if (!itemId || !fromLocation || !toLocation) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('inventory_location_rename', {
      p_item_id: itemId,
      p_from_location: fromLocation,
      p_to_location: toLocation,
      p_merge: merge,
    });

    if (error) {
      console.error('[location-rename] failed', { error: error.message, itemId, fromLocation, toLocation });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (data?.merge_required) {
      return NextResponse.json({ ok: false, merge_required: true, target_location: data.target_location }, { status: 409 });
    }

    return NextResponse.json({ ok: true, result: data });
  });
}

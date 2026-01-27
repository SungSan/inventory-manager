import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabase';

type RenamePayload = {
  itemId?: string;
  fromLocation?: string;
  toLocation?: string;
  merge?: boolean;
  memo?: string;
};

export async function POST(req: Request) {
  return withAuth(['admin', 'operator'], async (session) => {
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
    const memo = String(body.memo ?? 'location_edit:rename').trim() || 'location_edit:rename';

    if (!itemId || !fromLocation || !toLocation) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('inventory_location_rename', {
      p_from_location: fromLocation,
      p_item_id: itemId,
      p_to_location: toLocation,
      p_merge: merge,
      p_created_by: session.userId ?? null,
      p_memo: memo,
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

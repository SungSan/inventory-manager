import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordAdminLog } from '../../../../lib/admin-log';

export const runtime = 'nodejs';

type StockRow = {
  artist: string;
  category?: string;
  item?: string;
  album_version?: string;
  option?: string;
  location?: string;
  current_stock?: number;
  quantity?: number;
};

type HistoryRow = {
  artist: string;
  category?: string;
  item?: string;
  album_version?: string;
  option?: string;
  location?: string;
  direction?: string;
  quantity?: number;
  description?: string;
  memo?: string;
  timestamp?: string;
  created_at?: string;
};

async function ensureItemId(key: [string, string, string, string]) {
  const [artist, category, album_version, option] = key;
  const { data, error } = await supabaseAdmin
    .from('items')
    .upsert(
      { artist, category, album_version, option },
      { onConflict: 'artist,category,album_version,option' }
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id as string;
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: '파일을 선택하세요' }, { status: 400 });
    }

    const raw = await (file as Blob).text();
    let payload: any;

    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
    }

    const stocks: StockRow[] = payload.stock || payload.stocks || [];
    const history: HistoryRow[] = payload.history || payload.movements || [];

    let stockCount = 0;
    let historyCount = 0;

    for (const row of stocks) {
      if (!row.artist || !(row.item || row.album_version)) continue;
      const key: [string, string, string, string] = [
        row.artist,
        row.category || 'album',
        (row.album_version || row.item)!,
        row.option || '',
      ];

      const itemId = await ensureItemId(key);

      const { error } = await supabaseAdmin.from('inventory').upsert(
        {
          item_id: itemId,
          location: row.location || '',
          quantity: Number(row.current_stock ?? row.quantity ?? 0),
        },
        { onConflict: 'item_id,location' }
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      stockCount += 1;
    }

    for (const mov of history) {
      if (!mov.artist || !(mov.item || mov.album_version)) continue;

      const key: [string, string, string, string] = [
        mov.artist,
        mov.category || 'album',
        (mov.album_version || mov.item)!,
        mov.option || '',
      ];

      const itemId = await ensureItemId(key);

      const { error } = await supabaseAdmin.from('movements').insert({
        item_id: itemId,
        location: mov.location || '',
        direction: mov.direction || 'IN',
        quantity: Number(mov.quantity ?? 0),
        memo: mov.description || mov.memo || '',
        created_at: mov.timestamp || mov.created_at || null,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      historyCount += 1;
    }

    await recordAdminLog(
      session,
      'upload_inventory',
      `재고 ${stockCount}건, 이력 ${historyCount}건 업로드`
    );

    return NextResponse.json({ ok: true, stockCount, historyCount });
  });
}

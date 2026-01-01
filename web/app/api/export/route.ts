import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

function toCsv(rows: any[]) {
  if (!rows.length) return '';
  const header = Object.keys(rows[0]);
  const escape = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  return [header.join(','), ...rows.map((r) => header.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'inventory';
  return withAuth(req as any, ['admin', 'operator', 'viewer'], async () => {
    if (type === 'history') {
      const { data, error } = await supabaseAdmin
        .from('movements_view')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return new NextResponse(toCsv(data || []), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=history.csv' }
      });
    }
    const { data, error } = await supabaseAdmin.from('inventory_view').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return new NextResponse(toCsv(data || []), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=inventory.csv' }
    });
  });
}

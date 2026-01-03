import { NextResponse } from 'next/server';
import { utils, write } from 'xlsx';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

function toExcelBuffer(rows: any[], sheetName: string) {
  const workbook = utils.book_new();
  const safeRows = rows && rows.length ? rows : [{}];
  const sheet = utils.json_to_sheet(safeRows);
  utils.book_append_sheet(workbook, sheet, sheetName);
  return write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'inventory';
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    if (type === 'history') {
      const { data, error } = await supabaseAdmin
        .from('movements_view')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return new NextResponse(toExcelBuffer(data || [], 'History'), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename=history.xlsx'
        }
      });
    }
    const { data, error } = await supabaseAdmin.from('inventory_view').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return new NextResponse(toExcelBuffer(data || [], 'Inventory'), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=inventory.xlsx'
      }
    });
  });
}

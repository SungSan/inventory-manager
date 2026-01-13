import { NextResponse } from 'next/server';
import { utils, write } from 'xlsx';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

type InventoryExportRow = {
  artist: string;
  category: string;
  album_version: string;
  option: string;
  barcode: string | null;
  location: string;
  quantity: number;
};

function toExcelBuffer(rows: any[], sheetName: string) {
  const workbook = utils.book_new();
  const safeRows = rows && rows.length ? rows : [{}];
  const sheet = utils.json_to_sheet(safeRows);
  utils.book_append_sheet(workbook, sheet, sheetName);
  return write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function matchesInventoryFilters(
  row: InventoryExportRow,
  filters: { search?: string; category?: string; location?: string; artist?: string }
) {
  const searchValue = filters.search?.toLowerCase().trim() ?? '';
  const matchesSearch = !searchValue
    || [
      row.artist,
      row.album_version,
      row.option,
      row.location,
      row.barcode ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchValue);
  const matchesCategory = !filters.category || row.category === filters.category;
  const matchesLocation = !filters.location || row.location === filters.location;
  const matchesArtist = !filters.artist || row.artist === filters.artist;
  return matchesSearch && matchesCategory && matchesLocation && matchesArtist;
}

async function fetchInventoryExportRows(filters: {
  search?: string;
  category?: string;
  location?: string;
  artist?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, quantity, location, items:items(artist, category, album_version, option, barcode)');
  if (error) throw new Error(error.message);

  const rows: InventoryExportRow[] = (data || []).map((row: any) => {
    const item = Array.isArray(row.items) ? row.items[0] ?? {} : row.items ?? {};
    return {
      artist: item.artist ?? '',
      category: item.category ?? '',
      album_version: item.album_version ?? '',
      option: item.option ?? '',
      barcode: item.barcode ?? null,
      location: row.location ?? '',
      quantity: row.quantity ?? 0,
    };
  });

  return rows.filter((row) => matchesInventoryFilters(row, filters));
}

async function fetchHistoryExportRows(filters: {
  search?: string;
  direction?: string;
  from?: string;
  to?: string;
}) {
  const pageSize = 500;
  let page = 1;
  let attempts = 0;
  const allRows: any[] = [];

  while (true) {
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;
    let query = supabaseAdmin
      .from('movements_view')
      .select('*')
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);

    if (filters.direction) {
      query = query.eq('direction', filters.direction);
    }
    if (filters.from) {
      query = query.gte('created_at', new Date(filters.from).toISOString());
    }
    if (filters.to) {
      query = query.lte('created_at', new Date(`${filters.to}T23:59:59`).toISOString());
    }
    if (filters.search) {
      const escaped = filters.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
      query = query.or(
        [
          `artist.ilike.%${escaped}%`,
          `album_version.ilike.%${escaped}%`,
          `option.ilike.%${escaped}%`,
          `location.ilike.%${escaped}%`,
          `created_by.ilike.%${escaped}%`,
          `memo.ilike.%${escaped}%`,
        ].join(','),
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error('export_history_fetch', {
        step: 'export_history_fetch',
        page,
        message: error.message,
      });
      if (attempts < 1) {
        attempts += 1;
        continue;
      }
      throw new Error(error.message);
    }

    const batch = data || [];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }

  return allRows;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'inventory';
  return withAuth(['admin', 'operator', 'viewer'], async () => {
    try {
      if (type === 'history') {
        const rows = await fetchHistoryExportRows({
          search: searchParams.get('search') || '',
          direction: searchParams.get('direction') || '',
          from: searchParams.get('from') || '',
          to: searchParams.get('to') || '',
        });
        const dateSuffix = [searchParams.get('from') || 'all', searchParams.get('to') || 'all'].join('_');
        return new NextResponse(toExcelBuffer(rows || [], 'History_All'), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename=history_all_${dateSuffix}.xlsx`
          }
        });
      }
      const rows = await fetchInventoryExportRows({
        search: searchParams.get('search') || '',
        category: searchParams.get('category') || '',
        location: searchParams.get('location') || '',
        artist: searchParams.get('artist') || '',
      });
      const exportRows = rows.map((row) => ({
        artist: row.artist,
        category: row.category,
        album_version: row.album_version,
        option: row.option,
        barcode: row.barcode ?? '',
        location: row.location,
        quantity: row.quantity,
      }));
      const withBarcode = exportRows.filter((row) => Boolean(row.barcode)).length;
      console.info('export_map_row', {
        step: 'export_map_row',
        type: 'inventory',
        total: exportRows.length,
        withBarcode,
        withoutBarcode: exportRows.length - withBarcode,
      });
      return new NextResponse(toExcelBuffer(exportRows || [], 'Inventory'), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename=inventory.xlsx'
        }
      });
    } catch (error: any) {
      console.error('export_failed', { step: 'export_failed', message: error?.message || 'unknown error' });
      return NextResponse.json({ error: error?.message || 'export failed' }, { status: 500 });
    }
  });
}

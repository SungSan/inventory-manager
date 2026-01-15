import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

type InventoryApiRow = {
  inventory_id?: string | null;
  item_id?: string | null;
  barcode?: string | null;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location: string;
  quantity: number;
};

type InventoryLocation = {
  id: string;
  location: string;
  quantity: number;
  editableId?: string | null;
  item_id?: string | null;
  inventory_id?: string | null;
  location_prefix?: string;
};

type InventoryRow = {
  key: string;
  artist: string;
  category: string;
  album_version: string;
  option: string;
  location_prefix: string;
  total_quantity: number;
  locations: InventoryLocation[];
  inventory_id?: string | null;
  item_id?: string | null;
  barcode?: string | null;
};

function getLocationPrefix(location?: string | null) {
  const value = String(location ?? '').trim();
  if (!value) return '';
  const [prefix] = value.split('-');
  return prefix || value;
}

function groupInventoryRows(rows: InventoryApiRow[]): InventoryRow[] {
  const grouped = new Map<string, InventoryRow>();

  rows.forEach((row, idx) => {
    const artist = row.artist ?? '';
    const category = row.category ?? '';
    const album_version = row.album_version ?? '';
    const option = row.option ?? '';
    const locationPrefix = getLocationPrefix(row.location);
    const key = `${artist}|${category}|${album_version}|${option}|${locationPrefix}`;
    const qty = Number(row.quantity ?? 0);

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        artist,
        category,
        album_version,
        option,
        location_prefix: locationPrefix,
        total_quantity: 0,
        locations: [],
        inventory_id: row.inventory_id ?? null,
        item_id: row.item_id ?? null,
        barcode: row.barcode ?? null,
      });
    }

    const entry = grouped.get(key)!;
    entry.total_quantity += qty;
    if (!entry.item_id && row.item_id) {
      entry.item_id = row.item_id;
    }
    if (!entry.inventory_id && row.inventory_id) {
      entry.inventory_id = row.inventory_id;
    }
    if (!entry.barcode && row.barcode) {
      entry.barcode = row.barcode;
    }
    entry.locations.push({
      id: row.inventory_id || `${key}|${row.location}|${idx}`,
      editableId: row.inventory_id ?? null,
      inventory_id: row.inventory_id ?? null,
      item_id: row.item_id ?? null,
      location: row.location,
      location_prefix: locationPrefix,
      quantity: qty,
    });
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    locations: row.locations.sort((a, b) => a.location.localeCompare(b.location)),
  }));
}

async function loadLocationScope(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_location_permissions')
    .select('primary_location, sub_locations')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || undefined;
  const location = searchParams.get('location') || undefined;
  const category = searchParams.get('category') || undefined;
  const albumVersion = searchParams.get('album_version') || undefined;
  const q = searchParams.get('q') || undefined;
  const barcode = searchParams.get('barcode') || undefined;
  const view = searchParams.get('view') || undefined;
  const limitParam = Number(searchParams.get('limit'));
  const offsetParam = Number(searchParams.get('offset'));
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async (session) => {
    const locationFilter = location || undefined;
    let enforcedLocation = locationFilter;
    let allowedLocations: string[] | null = null;
    const isPrefixView = view === 'prefix';

    if (session.role === 'manager') {
      const scope = await loadLocationScope(session.userId ?? '');
      const primary = scope?.primary_location ? [scope.primary_location] : [];
      const subs = Array.isArray(scope?.sub_locations) ? scope?.sub_locations : [];
      allowedLocations = Array.from(new Set([...primary, ...subs].map((v) => String(v || '').trim()).filter(Boolean)));
      if (allowedLocations.length === 0) {
        return NextResponse.json(
          { ok: true, rows: [], page: { limit, offset, totalRows: 0 } },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (
        enforcedLocation &&
        !allowedLocations.includes(enforcedLocation) &&
        !(isPrefixView && allowedLocations.some((loc) => getLocationPrefix(loc) === enforcedLocation))
      ) {
        return NextResponse.json(
          { ok: true, rows: [], page: { limit, offset, totalRows: 0 } },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }

    let query = supabaseAdmin
      .from('inventory_view')
      .select(
        'inventory_id,item_id,artist,category,album_version,option,barcode,location,quantity',
        isPrefixView ? undefined : { count: 'exact' }
      )
      .order('artist', { ascending: true })
      .order('album_version', { ascending: true })
      .order('option', { ascending: true })
      .order('location', { ascending: true });

    if (artist) query = query.eq('artist', artist);
    if (!isPrefixView && enforcedLocation) {
      query = query.eq('location', enforcedLocation);
    } else if (allowedLocations) {
      query = query.in('location', allowedLocations);
    }
    if (category) query = query.eq('category', category);
    if (barcode) query = query.eq('barcode', barcode);
    if (albumVersion) {
      const term = `%${albumVersion}%`;
      query = query.ilike('album_version', term);
    }

    if (q) {
      const term = `%${q}%`;
      query = query.or(
        ['artist', 'album_version', 'option', 'location']
          .map((col) => `${col}.ilike.${term}`)
          .join(',')
      );
    }

    if (!isPrefixView) {
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json(
        {
          ok: true,
          rows: data ?? [],
          page: { limit, offset, totalRows: count ?? 0 },
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const sourceRows = (data ?? []) as InventoryApiRow[];
    const filteredRows = locationFilter
      ? sourceRows.filter((row) => getLocationPrefix(row.location) === locationFilter)
      : sourceRows;
    const grouped = groupInventoryRows(filteredRows);
    const totalRows = grouped.length;
    const paged = grouped.slice(offset, offset + limit);

    return NextResponse.json(
      {
        ok: true,
        rows: paged,
        page: { limit, offset, totalRows },
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}

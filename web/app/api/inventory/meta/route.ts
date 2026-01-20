import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';

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
  const barcode = searchParams.get('barcode') || undefined;
  const q = searchParams.get('q') || undefined;
  const prefix = searchParams.get('prefix') || undefined;
  const albumVersion = searchParams.get('album_version') || undefined;

  const qTerm = barcode || albumVersion || q || undefined;

  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async (session) => {
    let enforcedLocation = location || undefined;
    let allowedLocations: string[] | null = null;

    if (session.role === 'manager') {
      const scope = await loadLocationScope(session.userId ?? '');
      const primary = scope?.primary_location ? [scope.primary_location] : [];
      const subs = Array.isArray(scope?.sub_locations) ? scope?.sub_locations : [];
      allowedLocations = Array.from(new Set([...primary, ...subs].map((v) => String(v || '').trim()).filter(Boolean)));
      if (allowedLocations.length === 0) {
        return NextResponse.json(
          {
            ok: true,
            summary: { totalQuantity: 0, uniqueItems: 0, byLocation: {} },
            anomalyCount: 0,
            artists: [],
            locations: [],
            categories: [],
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (enforcedLocation && !allowedLocations.includes(enforcedLocation)) {
        return NextResponse.json(
          {
            ok: true,
            summary: { totalQuantity: 0, uniqueItems: 0, byLocation: {} },
            anomalyCount: 0,
            artists: [],
            locations: [],
            categories: [],
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (!enforcedLocation && allowedLocations.length === 1) {
        enforcedLocation = allowedLocations[0];
      }
    }

    if (session.role === 'manager' && allowedLocations && allowedLocations.length > 1 && !enforcedLocation) {
      let query = supabaseAdmin
        .from('inventory_view')
        .select('artist,category,album_version,option,location,quantity,barcode')
        .in('location', allowedLocations);

      if (artist) query = query.eq('artist', artist);
      if (category) query = query.eq('category', category);
      if (barcode) query = query.eq('barcode', barcode);
      if (albumVersion) {
        const term = `%${albumVersion}%`;
        query = query.ilike('album_version', term);
      }
      if (q) {
        const term = `%${q}%`;
        query = query.or(['artist', 'album_version', 'option', 'location'].map((col) => `${col}.ilike.${term}`).join(','));
      }

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const rows = data ?? [];
      const byLocation: Record<string, number> = {};
      const itemKeys = new Set<string>();
      const artists = new Set<string>();
      const locations = new Set<string>();
      const categories = new Set<string>();
      let totalQuantity = 0;
      let anomalyCount = 0;

      rows.forEach((row: any) => {
        const qty = Number(row.quantity ?? 0);
        totalQuantity += qty;
        const key = `${row.artist}|${row.category}|${row.album_version}|${row.option ?? ''}`;
        itemKeys.add(key);
        if (row.artist && (!prefix || row.artist.startsWith(prefix))) {
          artists.add(row.artist);
        }
        if (row.category) categories.add(row.category);
        if (row.location) locations.add(row.location);
        if (qty < 0) anomalyCount += 1;
        if (row.location) {
          byLocation[row.location] = (byLocation[row.location] ?? 0) + qty;
        }
      });

      return NextResponse.json(
        {
          ok: true,
          summary: {
            totalQuantity,
            uniqueItems: itemKeys.size,
            byLocation,
          },
          anomalyCount,
          artists: Array.from(artists),
          locations: Array.from(locations),
          categories: Array.from(categories),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const [summaryRes, anomalyRes, artistsRes, locationsRes, categoriesRes] = await Promise.all([
      supabaseAdmin.rpc('get_inventory_summary_v2', {
        p_artist: artist ?? null,
        p_category: category ?? null,
        p_location: enforcedLocation ?? null,
        p_q: qTerm ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_anomaly_count', {
        p_artist: artist ?? null,
        p_category: category ?? null,
        p_location: enforcedLocation ?? null,
        p_q: qTerm ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_artists', {
        p_prefix: prefix ?? null,
        p_category: category ?? null,
        p_location: enforcedLocation ?? null,
        p_q: qTerm ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_locations', {
        p_artist: artist ?? null,
        p_category: category ?? null,
        p_q: qTerm ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_categories', {
        p_artist: artist ?? null,
        p_location: enforcedLocation ?? null,
        p_q: qTerm ?? null,
      }),
    ]);

    const firstError = [summaryRes.error, anomalyRes.error, artistsRes.error, locationsRes.error, categoriesRes.error].find(
      Boolean
    );
    if (firstError) {
      return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
    }

    const summaryRow = summaryRes.data?.[0] ?? {};
    const anomalyRow = anomalyRes.data?.[0] ?? {};

    return NextResponse.json(
      {
        ok: true,
        summary: {
          totalQuantity: summaryRow.total_quantity ?? 0,
          uniqueItems: summaryRow.unique_items ?? 0,
          byLocation: summaryRow.by_location ?? {},
        },
        anomalyCount: Number(anomalyRow.count ?? anomalyRow.total ?? anomalyRow.anomaly_count ?? 0) || 0,
        artists: artistsRes.data?.map((row: any) => row.artist).filter(Boolean) ?? [],
        locations: locationsRes.data?.map((row: any) => row.location).filter(Boolean) ?? [],
        categories: categoriesRes.data?.map((row: any) => row.category).filter(Boolean) ?? [],
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}

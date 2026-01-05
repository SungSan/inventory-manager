import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';

function isMissingLocationScopeTable(error: any) {
  const message = error?.message || '';
  const code = error?.code || '';
  return code === '42P01' || message.includes('user_location_permissions');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || undefined;
  const location = searchParams.get('location') || undefined;
  const category = searchParams.get('category') || undefined;
  const q = searchParams.get('q') || undefined;
  const prefix = searchParams.get('prefix') || undefined;
  const albumVersion = searchParams.get('album_version') || undefined;

  const qTerm = albumVersion || q || undefined;

  return withAuth(['admin', 'operator', 'viewer', 'l_operator'], async (session) => {
    let enforcedLocation = location || undefined;
    if (session.role === 'l_operator') {
      const { data: scope, error: scopeError } = await supabaseAdmin
        .from('user_location_permissions')
        .select('primary_location')
        .eq('user_id', session.userId)
        .maybeSingle();
      if (scopeError) {
        if (isMissingLocationScopeTable(scopeError)) {
          console.warn('location scope table missing, skipping enforcement');
        } else {
          console.error('location scope fetch error:', scopeError);
          return NextResponse.json({ ok: false, error: 'location scope missing', step: 'location_scope' }, { status: 403 });
        }
      } else if (!scope?.primary_location) {
        return NextResponse.json({ ok: false, error: 'location scope missing', step: 'location_scope' }, { status: 403 });
      } else {
        enforcedLocation = scope.primary_location;
      }
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

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { withAuth } from '../../../../lib/auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get('artist') || undefined;
  const location = searchParams.get('location') || undefined;
  const q = searchParams.get('q') || undefined;
  const prefix = searchParams.get('prefix') || undefined;

  return withAuth(['admin', 'operator', 'viewer'], async () => {
    const [summaryRes, anomalyRes, artistsRes, locationsRes] = await Promise.all([
      supabaseAdmin.rpc('get_inventory_summary_v2', {
        p_artist: artist ?? null,
        p_location: location ?? null,
        p_q: q ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_anomaly_count', {
        p_artist: artist ?? null,
        p_location: location ?? null,
        p_q: q ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_artists', {
        p_prefix: prefix ?? null,
        p_location: location ?? null,
        p_q: q ?? null,
      }),
      supabaseAdmin.rpc('get_inventory_locations', {
        p_artist: artist ?? null,
        p_q: q ?? null,
      }),
    ]);

    const firstError = [summaryRes.error, anomalyRes.error, artistsRes.error, locationsRes.error].find(Boolean);
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
        anomalyCount: Number(anomalyRow.count ?? anomalyRow.total ?? 0),
        artists: artistsRes.data?.map((row: any) => row.artist).filter(Boolean) ?? [],
        locations: locationsRes.data?.map((row: any) => row.location).filter(Boolean) ?? [],
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  });
}

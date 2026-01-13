import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

async function fetchLocationSnapshot(seed: string[] = []) {
  const [movements, inventory] = await Promise.all([
    supabaseAdmin.from('movements').select('location'),
    supabaseAdmin.from('inventory').select('location'),
  ]);

  const errors = [movements.error, inventory.error].filter(Boolean);
  if (errors.length === 2) {
    return { locations: [] as string[], error: errors.map((e) => e?.message).join('; ') };
  }

  const set = new Set<string>(seed.map((name) => name.trim()).filter(Boolean));

  (movements.data || []).forEach((row: { location?: string | null }) => {
    if (row.location) {
      set.add(row.location);
    }
  });

  (inventory.data || []).forEach((row: { location?: string | null }) => {
    if (row.location) {
      set.add(row.location);
    }
  });

  const locations = Array.from(set).sort((a, b) => a.localeCompare(b));
  return { locations, error: errors[0]?.message };
}

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer', 'manager'], async () => {
    const { locations, error } = await fetchLocationSnapshot();

    if (error && locations.length === 0) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json(locations);
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async () => {
    const { name } = await req.json();
    const normalized = String(name || '').trim();

    if (!normalized) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { locations } = await fetchLocationSnapshot([normalized]);
    return NextResponse.json(locations);
  });
}

export async function DELETE(req: Request) {
  return withAuth(['admin'], async () => {
    const { name } = await req.json();
    const normalized = String(name || '').trim();

    if (!normalized) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { locations } = await fetchLocationSnapshot();
    const pruned = locations.filter((loc) => loc !== normalized);

    return NextResponse.json(pruned);
  });
}

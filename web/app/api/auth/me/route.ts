import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';
import { supabaseAdmin } from '../../../../lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ authenticated: false });
  }

  const { data: userRow, error } = await supabaseAdmin
    .from('users')
    .select('id, email, role, approved, active')
    .eq('id', session.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { authenticated: false, error: error.message, step: 'load_user' },
      { status: 500 }
    );
  }

  if (!userRow) {
    return NextResponse.json({ authenticated: false, error: 'user not found', step: 'missing_user' }, { status: 403 });
  }

  let username: string | null = null;
  try {
    const { data: profileRow } = await supabaseAdmin
      .from('user_profiles')
      .select('username')
      .eq('user_id', session.userId)
      .maybeSingle();
    username = (profileRow as any)?.username ?? null;
  } catch (profileError) {
    console.error('[auth/me] profile lookup failed', profileError);
  }

  let primary_location: string | null = null;
  let sub_locations: string[] = [];
  try {
    const { data: scopeRow, error: scopeError } = await supabaseAdmin
      .from('user_location_permissions')
      .select('primary_location, sub_locations')
      .eq('user_id', session.userId)
      .maybeSingle();

    if (!scopeError && scopeRow) {
      primary_location = (scopeRow as any)?.primary_location ?? null;
      const subs = (scopeRow as any)?.sub_locations;
      sub_locations = Array.isArray(subs) ? subs.filter(Boolean) : [];
    }
  } catch (scopeError) {
    console.warn('[auth/me] scope lookup skipped', { message: (scopeError as any)?.message });
  }
  const specialAdmin = session.email?.toLowerCase() === 'tksdlvkxl@gmail.com';

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email ?? null,
    role: userRow.role ?? session.role ?? null,
    expiresAt: session.expiresAt ?? null,
    approved: specialAdmin ? true : userRow.approved ?? false,
    username,
    locationScope: primary_location || sub_locations.length > 0 ? { primary_location, sub_locations } : null,
  });
}

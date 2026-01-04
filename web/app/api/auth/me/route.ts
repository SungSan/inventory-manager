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
    .select('id, email, role, approved, active, user_profiles(username)')
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

  const profile = (userRow as any)?.user_profiles?.[0] ?? (userRow as any)?.user_profiles ?? null;
  const specialAdmin = session.email?.toLowerCase() === 'tksdlvkxl@gmail.com';

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email ?? null,
    role: userRow.role ?? session.role ?? null,
    expiresAt: session.expiresAt ?? null,
    approved: specialAdmin ? true : userRow.approved ?? false,
    username: profile?.username ?? null,
  });
}

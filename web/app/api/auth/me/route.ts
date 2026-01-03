import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';
import { supabaseAdmin } from '../../../../lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ authenticated: false });
  }

  const { data: profile } = await supabaseAdmin
    .from('admin_users_view')
    .select('approved, username')
    .eq('id', session.userId)
    .single();

  const specialAdmin = session.email?.toLowerCase() === 'tksdlvkxl@gmail.com';

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email ?? null,
    role: session.role ?? null,
    expiresAt: session.expiresAt ?? null,
    approved: specialAdmin ? true : profile?.approved ?? false,
    username: profile?.username ?? null,
  });
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase';
import type { Role } from './session';

export type MobileSession = {
  userId: string;
  email: string;
  role: Role;
};

function extractBearerToken(req: Request | NextRequest) {
  const header = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export async function withAuthMobile(
  roles: Role[],
  req: Request | NextRequest,
  handler: (session: MobileSession) => Promise<NextResponse>
) {
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'unauthorized', step: 'missing_token' }, { status: 401 });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return NextResponse.json({ error: 'unauthorized', step: 'invalid_token' }, { status: 401 });
  }

  const authUser = authData.user;
  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, approved, active')
    .eq('id', authUser.id)
    .maybeSingle();

  if (userError) {
    return NextResponse.json({ error: userError.message, step: 'load_user' }, { status: 500 });
  }

  if (!userRow) {
    return NextResponse.json({ error: 'forbidden', step: 'missing_user' }, { status: 403 });
  }

  const role = userRow.role as Role;

  if (userRow.approved === false) {
    return NextResponse.json({ error: 'forbidden', step: 'not_approved' }, { status: 403 });
  }

  if (userRow.active === false) {
    return NextResponse.json({ error: 'forbidden', step: 'inactive' }, { status: 403 });
  }

  if (!roles.includes(role)) {
    return NextResponse.json({ error: 'forbidden', step: 'insufficient_role' }, { status: 403 });
  }

  return handler({
    userId: authUser.id,
    email: userRow.email ?? authUser.email ?? '',
    role,
  });
}

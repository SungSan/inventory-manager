import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';
import type { Role } from '../../../../lib/session';

export async function POST(req: Request) {
  return withAuth(['admin'], async () => {
    const { email, password, role } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const hashed = await bcrypt.hash(String(password), 10);
    const userRole: Role = (role as Role) || 'operator';

    const { error } = await supabaseAdmin.from('users').insert({
      email: normalizedEmail,
      password_hash: hashed,
      role: userRole,
      active: true
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, role: userRole });
  });
}

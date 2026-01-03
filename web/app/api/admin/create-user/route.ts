import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { recordAdminLog } from '../../../../lib/admin-log';
import { createUserWithProfile } from '../../../../lib/create-user';
import type { Role } from '../../../../lib/session';

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { id, username, password, full_name, department, contact, purpose, role } = await req.json();

    const loginId = (username ?? id ?? '').toString().trim();

    if (!loginId || !full_name || !department) {
      return NextResponse.json({ error: 'ID/성함/부서를 모두 입력하세요.' }, { status: 400 });
    }

    const userRole: Role = (role as Role) || 'viewer';

    try {
      const result = await createUserWithProfile({
        username: loginId,
        password: password ? String(password) : undefined,
        full_name: String(full_name ?? ''),
        department: String(department ?? ''),
        contact: String(contact ?? ''),
        purpose: String(purpose ?? ''),
        role: userRole,
        active: true,
        approved: true,
        approved_by: session.userId,
      });

      await recordAdminLog(session, 'create_user', `${loginId} (${result.role}) / ${full_name ?? ''}`);

      return NextResponse.json({ ok: true, user_id: result.userId, role: result.role });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
    }
  });
}

import { NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/auth';
import { recordAdminLog } from '../../../../../lib/admin-log';
import { createUserWithProfile } from '../../../../../lib/create-user';
import type { Role } from '../../../../../lib/session';

function isStrongPassword(value: string) {
  if (!value || value.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasNumber = /\d/.test(value);
  return hasLetter && hasNumber;
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
    const { id, password, full_name, department, contact, purpose, role } = await req.json();

    if (!id || !password || !full_name || !department) {
      return NextResponse.json({ error: 'ID/비밀번호/성함/부서를 모두 입력하세요.' }, { status: 400 });
    }

    if (!isStrongPassword(password)) {
      return NextResponse.json({ error: '비밀번호는 영문/숫자를 포함해 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const userRole: Role = (role as Role) || 'operator';

    try {
      const result = await createUserWithProfile({
        id: String(id).toLowerCase().trim(),
        password: String(password),
        full_name: String(full_name ?? ''),
        department: String(department ?? ''),
        contact: String(contact ?? ''),
        purpose: String(purpose ?? ''),
        role: userRole,
      });

      await recordAdminLog(session, 'create_user', `${id} (${result.role}) / ${full_name ?? ''}`);

      return NextResponse.json({ ok: true, user_id: result.userId, role: result.role });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
    }
  });
}

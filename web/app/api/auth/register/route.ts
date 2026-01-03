import { NextResponse } from 'next/server';
import { createUserWithProfile } from '../../../../lib/create-user';

function isStrongPassword(value: string) {
  if (!value || value.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasNumber = /\d/.test(value);
  return hasLetter && hasNumber;
}

export async function POST(req: Request) {
  const { id, password, confirm, name, department, contact, purpose } = await req.json();
  const loginId = (id ?? '').toString().trim();
  const pwd = (password ?? '').toString();
  const pwdConfirm = (confirm ?? '').toString();
  const fullName = (name ?? '').toString().trim();
  const dept = (department ?? '').toString().trim();
  const contactInfo = (contact ?? '').toString().trim();
  const userPurpose = (purpose ?? '').toString().trim();

  if (!loginId || !pwd || !pwdConfirm || !fullName || !dept) {
    return NextResponse.json({ error: '필수 항목을 모두 입력하세요.' }, { status: 400 });
  }

  if (pwd !== pwdConfirm) {
    return NextResponse.json({ error: '비밀번호가 일치하지 않습니다.' }, { status: 400 });
  }

  if (!isStrongPassword(pwd)) {
    return NextResponse.json({ error: '비밀번호는 영문/숫자를 포함해 8자 이상이어야 합니다.' }, { status: 400 });
  }

  try {
    await createUserWithProfile({
      id: loginId,
      password: pwd,
      role: 'viewer',
      full_name: fullName,
      department: dept,
      contact: contactInfo,
      purpose: userPurpose,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
  }
}

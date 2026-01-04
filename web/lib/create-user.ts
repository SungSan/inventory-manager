import crypto from 'crypto';
import { supabaseAdmin } from './supabase';
import type { Role } from './session';

const CORPORATE_DOMAIN = 'sound-wave.co.kr';

function normalizeUsername(raw: string) {
  const username = raw.trim();
  if (!username || /\s/.test(username) || username.includes('@')) {
    throw new Error('유효한 사내 ID를 입력하세요. 공백이나 @ 문자를 포함할 수 없습니다.');
  }
  return username.toLowerCase();
}

function deriveEmail(username: string) {
  return `${username}@${CORPORATE_DOMAIN}`;
}

export interface CreateUserPayload {
  id?: string;
  username?: string;
  password?: string;
  full_name?: string;
  department?: string;
  contact?: string;
  purpose?: string;
  role?: Role;
  active?: boolean;
  approved?: boolean;
  approved_by?: string | null;
}

export interface CreateUserResult {
  userId: string | null;
  role: Role;
}

export async function createUserWithProfile(payload: CreateUserPayload): Promise<CreateUserResult> {
  const username = normalizeUsername((payload.username ?? payload.id ?? '').toString());
  const password = (payload.password ?? crypto.randomBytes(12).toString('hex')).toString();
  const fullName = (payload.full_name ?? '').toString().trim();
  const department = (payload.department ?? '').toString().trim();
  const contact = (payload.contact ?? '').toString().trim();
  const purpose = (payload.purpose ?? '').toString().trim();
  const role: Role = (payload.role as Role) ?? 'viewer';
  const activeFlag = payload.active === true;
  const approvedFlag = payload.approved === true;
  const email = deriveEmail(username);
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      full_name: fullName,
      department,
      contact,
      purpose,
      role,
    },
  });

  if (authError) {
    throw new Error(authError.message);
  }

  const authId = authData?.user?.id;

  if (!authId) {
    throw new Error('auth user id 생성에 실패했습니다.');
  }

  const { error: userError } = await supabaseAdmin
    .from('users')
    .upsert({
      id: authId,
      email,
      role,
      approved: approvedFlag,
      active: approvedFlag && activeFlag,
    });

  if (userError) {
    throw new Error(userError.message);
  }

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: authId,
      username,
      approved: approvedFlag,
      role,
      requested_at: new Date().toISOString(),
      approved_at: approvedFlag ? new Date().toISOString() : null,
      approved_by: approvedFlag ? payload.approved_by ?? null : null,
    });

  if (profileError) {
    throw new Error(profileError.message);
  }

  return { userId: authId, role };
}

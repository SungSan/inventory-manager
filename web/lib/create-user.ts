import { supabaseAdmin } from './supabase';
import type { Role } from './session';

export interface CreateUserPayload {
  id: string;
  password: string;
  full_name?: string;
  department?: string;
  contact?: string;
  purpose?: string;
  role?: Role;
}

export interface CreateUserResult {
  userId: string | null;
  role: Role;
}

export async function createUserWithProfile(payload: CreateUserPayload): Promise<CreateUserResult> {
  const loginId = (payload.id ?? '').toString().trim();
  const password = (payload.password ?? '').toString();
  const fullName = (payload.full_name ?? '').toString().trim();
  const department = (payload.department ?? '').toString().trim();
  const contact = (payload.contact ?? '').toString().trim();
  const purpose = (payload.purpose ?? '').toString().trim();
  const role: Role = (payload.role as Role) ?? 'operator';

  const authEmail = loginId.includes('@') ? loginId : `${loginId}@local`;

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: {
      login_id: loginId,
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

  const { data: profileData, error: profileError } = await supabaseAdmin.rpc('create_user', {
    p_email: loginId,
    p_password: password,
    p_role: role,
    p_full_name: fullName,
    p_department: department,
    p_contact: contact,
    p_purpose: purpose,
  });

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profileRow = Array.isArray(profileData) ? profileData[0] : profileData;
  const userId = authData?.user?.id ?? profileRow?.id ?? null;

  return { userId, role: profileRow?.role ?? role };
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAuth } from '../../../lib/auth';

type NoticePayload = {
  enabled: boolean;
  title: string;
  body: string;
  version: string;
  updatedAt: string;
};

const EMPTY_NOTICE: NoticePayload = {
  enabled: false,
  title: '',
  body: '',
  version: '',
  updatedAt: '',
};

type PurposePayload = {
  system_notice?: NoticePayload;
  legacy_purpose?: string;
  [key: string]: unknown;
};

const SYSTEM_NOTICE_EMAIL = 'tksdlvkxl@gmail.com';

async function getSystemAdminUserId(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .schema('auth')
    .from('users')
    .select('id')
    .eq('email', SYSTEM_NOTICE_EMAIL)
    .maybeSingle();

  if (error) {
    console.error('[notice] admin lookup failed', { error: error.message, email: SYSTEM_NOTICE_EMAIL });
    return null;
  }

  return data?.id ?? null;
}

function parsePurpose(raw?: string | null): PurposePayload {
  const value = String(raw ?? '').trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as PurposePayload;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return { legacy_purpose: value };
  } catch (error) {
    return { legacy_purpose: value };
  }
}

async function loadLatestNotice(): Promise<NoticePayload> {
  const adminId = await getSystemAdminUserId();
  if (!adminId) return EMPTY_NOTICE;

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('purpose')
    .eq('user_id', adminId)
    .maybeSingle();

  if (error) {
    console.error('[notice] load failed', { error: error.message });
    return EMPTY_NOTICE;
  }

  const parsed = parsePurpose(data?.purpose);
  const detail = parsed.system_notice ?? EMPTY_NOTICE;
  return {
    enabled: Boolean(detail.enabled),
    title: String(detail.title ?? ''),
    body: String(detail.body ?? ''),
    version: String(detail.version ?? ''),
    updatedAt: String(detail.updatedAt ?? ''),
  };
}

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async () => {
    const notice = await loadLatestNotice();
    return NextResponse.json(notice, { headers: { 'Cache-Control': 'no-store' } });
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async () => {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      console.error('[notice] parse failed', { error });
      return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 });
    }

    const enabled = Boolean(body?.enabled);
    const title = String(body?.title ?? '').trim();
    const noticeBody = String(body?.body ?? '').trim();
    const updatedAt = new Date().toISOString();
    const version = updatedAt;

    const detail: NoticePayload = {
      enabled,
      title,
      body: noticeBody,
      version,
      updatedAt,
    };

    const adminId = await getSystemAdminUserId();
    if (!adminId) {
      console.error('[notice] admin not found');
      return NextResponse.json({ ok: false, error: 'admin not found' }, { status: 500 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('purpose')
      .eq('user_id', adminId)
      .maybeSingle();

    if (profileError) {
      console.error('[notice] profile load failed', { error: profileError.message });
      return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    const merged: PurposePayload = {
      ...parsePurpose(profile?.purpose),
      system_notice: detail,
    };

    const { error, count } = await supabaseAdmin
      .from('user_profiles')
      .update({ purpose: JSON.stringify(merged) }, { count: 'exact' })
      .eq('user_id', adminId);

    if (error) {
      console.error('[notice] save failed', { error: error.message, detail });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if ((count ?? 0) !== 1) {
      console.error('[notice] save affected unexpected rows', { count });
      return NextResponse.json({ ok: false, error: 'notice save failed' }, { status: 500 });
    }

    const { data: updated, error: readError } = await supabaseAdmin
      .from('user_profiles')
      .select('purpose')
      .eq('user_id', adminId)
      .maybeSingle();
    if (readError) {
      console.error('[notice] save verification failed', { error: readError.message });
      return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
    }
    const verified = parsePurpose(updated?.purpose).system_notice ?? detail;
    return NextResponse.json({
      ...detail,
      enabled: Boolean(verified.enabled),
      title: String(verified.title ?? ''),
      body: String(verified.body ?? ''),
      version: String(verified.version ?? detail.version),
      updatedAt: String(verified.updatedAt ?? detail.updatedAt),
    });
  });
}

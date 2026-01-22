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

const NOTICE_STORAGE_KEY = '__notice__';

async function loadLatestNotice(): Promise<NoticePayload> {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('description')
    .eq('name', NOTICE_STORAGE_KEY)
    .maybeSingle();

  if (error) {
    console.error('[notice] load failed', { error: error.message });
    return EMPTY_NOTICE;
  }

  const raw = data?.description ?? '';
  if (!raw) return EMPTY_NOTICE;
  try {
    const detail = JSON.parse(raw) as Partial<NoticePayload>;
    return {
      enabled: Boolean(detail.enabled),
      title: String(detail.title ?? ''),
      body: String(detail.body ?? ''),
      version: String(detail.version ?? ''),
      updatedAt: String(detail.updatedAt ?? ''),
    };
  } catch (parseError) {
    console.error('[notice] parse failed', { error: parseError });
    return EMPTY_NOTICE;
  }
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

    const { error } = await supabaseAdmin
      .from('locations')
      .upsert({ name: NOTICE_STORAGE_KEY, description: JSON.stringify(detail) });

    if (error) {
      console.error('[notice] save failed', { error: error.message, detail });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json(detail);
  });
}

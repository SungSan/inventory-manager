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

async function loadLatestNotice(): Promise<NoticePayload> {
  const { data, error } = await supabaseAdmin
    .from('admin_logs')
    .select('detail, created_at')
    .eq('action', 'notice')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[notice] load failed', { error: error.message });
    return EMPTY_NOTICE;
  }

  const row = data?.[0];
  if (!row?.detail) {
    return EMPTY_NOTICE;
  }

  const detail = row.detail as Partial<NoticePayload>;
  return {
    enabled: Boolean(detail.enabled),
    title: String(detail.title ?? ''),
    body: String(detail.body ?? ''),
    version: String(detail.version ?? ''),
    updatedAt: String(detail.updatedAt ?? row.created_at ?? ''),
  };
}

export async function GET() {
  return withAuth(['admin', 'operator', 'viewer', 'l_operator', 'manager'], async () => {
    const notice = await loadLatestNotice();
    return NextResponse.json(notice, { headers: { 'Cache-Control': 'no-store' } });
  });
}

export async function POST(req: Request) {
  return withAuth(['admin'], async (session) => {
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

    const { error } = await supabaseAdmin.from('admin_logs').insert({
      actor_id: session.userId ?? null,
      actor_email: session.email ?? null,
      action: 'notice',
      detail,
    });

    if (error) {
      console.error('[notice] save failed', { error: error.message });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json(detail);
  });
}

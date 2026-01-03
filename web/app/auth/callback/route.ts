import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { deriveEmail, loginWithAccessToken, normalizeUsername } from '../../../lib/auth';
import { getSessionFromRequest, sessionMaxAgeMs } from '../../../lib/session';

function getSiteUrl(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return base;
}

function redirectWithError(req: NextRequest, message: string) {
  const siteUrl = getSiteUrl(req);
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, siteUrl));
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const token = url.searchParams.get('code') || url.searchParams.get('token_hash');
    const typeParam = url.searchParams.get('type') || 'magiclink';
    const rawId = url.searchParams.get('id') || url.searchParams.get('username') || url.searchParams.get('user');
    const emailParam = url.searchParams.get('email');

    if (!token) {
      return redirectWithError(req, '인증 코드가 누락되었습니다. 다시 로그인하세요.');
    }

    let email: string | null = null;
    let username: string | null = null;

    try {
      if (emailParam) {
        if (emailParam.includes('@')) {
          email = emailParam.toLowerCase();
          username = email.split('@')[0];
        } else {
          const normalized = normalizeUsername(emailParam);
          username = normalized;
          email = deriveEmail(normalized);
        }
      } else if (rawId) {
        const normalized = normalizeUsername(rawId);
        username = normalized;
        email = deriveEmail(normalized);
      }
    } catch (err: any) {
      return redirectWithError(req, err?.message || '유효하지 않은 ID입니다.');
    }

    if (!email || !username) {
      return redirectWithError(req, 'ID 정보를 확인할 수 없습니다. 다시 시도하세요.');
    }

    const verifyType = typeParam === 'signup' ? 'signup' : 'magiclink';
    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      email,
      token_hash: token,
      type: verifyType as any,
    } as any);

    if (error || !data?.session?.access_token) {
      return redirectWithError(req, error?.message || 'OTP 검증에 실패했습니다.');
    }

    const loginResult = await loginWithAccessToken(data.session.access_token, username);

    if ('pending' in loginResult && (loginResult as any).pending) {
      return redirectWithError(req, '관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
    }

    const siteUrl = getSiteUrl(req);
    const baseResponse = NextResponse.redirect(new URL('/', siteUrl));
    const { session, response } = await getSessionFromRequest(req, baseResponse);
    session.userId = (loginResult as any).id;
    session.email = (loginResult as any).email;
    session.role = (loginResult as any).role;
    session.expiresAt = Date.now() + sessionMaxAgeMs;
    await session.save();
    return response;
  } catch (err: any) {
    return redirectWithError(req, err?.message || '인증 처리에 실패했습니다.');
  }
}

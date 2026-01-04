import { NextRequest, NextResponse } from 'next/server';

function getSiteUrl(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return base;
}

function redirectWithError(req: NextRequest, message: string) {
  const siteUrl = getSiteUrl(req);
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, siteUrl));
}

export async function GET(req: NextRequest) {
  return redirectWithError(req, '이메일/OTP 인증은 비활성화되었습니다. ID와 비밀번호로 로그인하세요.');
}

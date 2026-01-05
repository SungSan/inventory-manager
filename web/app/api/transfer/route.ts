import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'transfer is not available in this deployment',
      step: 'transfer_disabled',
    },
    { status: 501 }
  );
}

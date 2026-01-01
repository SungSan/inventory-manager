import { NextRequest } from 'next/server';
import { clearSession } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  return clearSession(req);
}

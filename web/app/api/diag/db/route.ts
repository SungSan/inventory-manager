import { NextResponse } from 'next/server';
import { withAuth } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

function getProjectRef() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const hostname = new URL(supabaseUrl).hostname;
    return hostname.split('.')[0] || '';
  } catch (error) {
    console.warn('[diag-db] unable to parse supabase project ref', { error: (error as any)?.message });
    return '';
  }
}

export async function GET() {
  return withAuth(['admin'], async () => {
    const projectRef = getProjectRef();
    const { data, error } = await supabaseAdmin.rpc('diag_db_snapshot');

    if (error) {
      console.error('[diag-db] diag_db_snapshot failed', {
        message: error.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
        code: (error as any)?.code,
      });
    }

    return NextResponse.json({
      project_ref: projectRef || 'unknown',
      diag: data ?? null,
      diag_error: error
        ? {
            message: error.message,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            code: (error as any)?.code ?? null,
          }
        : null,
    });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getWidgetConfig, ensureDefaultTenantAndChannel } from '@/lib/db';
import { signWidgetSession } from '@/lib/security-utils';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const config = await getWidgetConfig();
    const { tenantId } = await ensureDefaultTenantAndChannel();
    const { searchParams } = new URL(request.url);
    const existingSessionId = searchParams.get('sessionId');
    const sessionId = existingSessionId || `sess_${crypto.randomUUID()}`;
    const sessionToken = signWidgetSession(sessionId, tenantId);

    return NextResponse.json(
      {
        ...config,
        sessionId,
        sessionToken,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      }
    );
  } catch (error) {
    console.error('Failed to get widget config:', error);
    return NextResponse.json({ message: 'Failed to fetch widget config' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token',
    },
  });
}

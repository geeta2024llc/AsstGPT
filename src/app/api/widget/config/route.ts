import { NextResponse } from 'next/server';
import { getWidgetConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getWidgetConfig();
    return NextResponse.json(config, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
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
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

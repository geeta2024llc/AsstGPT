import { NextRequest, NextResponse } from 'next/server';
import { getCannedResponses, createCannedResponse, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const list = await getCannedResponses();
      return NextResponse.json(list);
    } catch (error) {
      console.error('Failed to get canned responses:', error);
      return NextResponse.json({ message: 'Failed to fetch canned responses' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { title, shortcut, content, category } = body;

      if (!title || !shortcut || !content) {
        return NextResponse.json(
          { message: 'Missing required fields: title, shortcut, and content' },
          { status: 400 }
        );
      }

      const created = await createCannedResponse({
        title,
        shortcut,
        content,
        category: category || 'general',
      });

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Canned Response Created',
        details: `Created quick reply shortcut "/${created.shortcut}" (${title})`,
        type: 'info',
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error: any) {
      console.error('Failed to create canned response:', error);
      return NextResponse.json(
        { message: error.message || 'Failed to create canned response' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);

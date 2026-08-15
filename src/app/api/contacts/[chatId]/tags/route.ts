import { NextRequest, NextResponse } from 'next/server';
import { addContactTag, removeContactTag, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split('/');
      const chatId = segments[segments.length - 2] || '';
      const decodedChatId = decodeURIComponent(chatId);
      const body = await request.json();
      const { tag } = body;

      if (!tag || typeof tag !== 'string') {
        return NextResponse.json({ message: 'Missing tag' }, { status: 400 });
      }

      const updatedTags = await addContactTag(decodedChatId, tag);

      await addLog({
        user: ctx.userId || 'Agent',
        action: 'Contact Tag Added',
        details: `Added tag "${tag}" to ${decodedChatId}`,
        type: 'info',
      });

      return NextResponse.json({ tags: updatedTags });
    } catch (error: any) {
      console.error('Failed to add tag:', error);
      return NextResponse.json({ message: error.message || 'Failed to add tag' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split('/');
      const chatId = segments[segments.length - 2] || '';
      const decodedChatId = decodeURIComponent(chatId);
      const body = await request.json();
      const { tag } = body;

      if (!tag || typeof tag !== 'string') {
        return NextResponse.json({ message: 'Missing tag' }, { status: 400 });
      }

      const updatedTags = await removeContactTag(decodedChatId, tag);

      await addLog({
        user: ctx.userId || 'Agent',
        action: 'Contact Tag Removed',
        details: `Removed tag "${tag}" from ${decodedChatId}`,
        type: 'info',
      });

      return NextResponse.json({ tags: updatedTags });
    } catch (error: any) {
      console.error('Failed to remove tag:', error);
      return NextResponse.json({ message: error.message || 'Failed to remove tag' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

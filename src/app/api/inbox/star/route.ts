import { NextRequest, NextResponse } from 'next/server';
import { getContactProfile, updateContactProfile, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const PATCH = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { chatId, isStarred } = body;

      if (!chatId) {
        return NextResponse.json({ message: 'chatId is required' }, { status: 400 });
      }

      const existing = await getContactProfile(chatId);
      let currentTags: string[] = existing?.tags || [];

      if (isStarred) {
        if (!currentTags.includes('starred')) {
          currentTags = [...currentTags, 'starred'];
        }
      } else {
        currentTags = currentTags.filter((t) => t !== 'starred');
      }

      const updated = await updateContactProfile(chatId, {
        tags: currentTags,
        customAttributes: {
          ...(existing?.customAttributes || {}),
          isStarred: !!isStarred,
        },
      });

      await addLog({
        user: ctx.userId || 'Agent',
        action: isStarred ? 'Conversation Starred' : 'Conversation Unstarred',
        details: `${isStarred ? 'Starred' : 'Unstarred'} conversation with ${chatId}`,
        type: 'info',
      });

      return NextResponse.json({
        success: true,
        chatId,
        isStarred: !!isStarred,
        contact: updated,
      });
    } catch (error: any) {
      console.error('Failed to toggle star on conversation:', error);
      return NextResponse.json(
        { message: error.message || 'Failed to update star status' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

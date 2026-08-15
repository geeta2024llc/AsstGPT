import { NextRequest, NextResponse } from 'next/server';
import { mergeDuplicateContacts, mergeContactByChatId, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json().catch(() => ({}));
      const { sourceChatId, targetIdentifier } = body;

      if (sourceChatId && targetIdentifier) {
        const result = await mergeContactByChatId(sourceChatId, targetIdentifier);
        if (!result.success) {
          return NextResponse.json({ message: result.message || 'Merge failed.' }, { status: 400 });
        }

        await addLog({
          user: ctx.userId || 'Agent',
          action: 'Contacts Merged',
          details: `Manually merged contact "${sourceChatId}" into "${targetIdentifier}"`,
          type: 'info',
        });

        return NextResponse.json({ success: true });
      }

      const result = await mergeDuplicateContacts();

      await addLog({
        user: ctx.userId || 'Agent',
        action: 'Contacts Merged',
        details: `Ran automatic duplicate-contact merge: ${result.mergedGroups} group(s) merged`,
        type: 'info',
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error('Failed to merge contacts:', error);
      return NextResponse.json({ message: error.message || 'Failed to merge contacts' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

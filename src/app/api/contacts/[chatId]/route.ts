import { NextRequest, NextResponse } from 'next/server';
import { getContactProfile, updateContactProfile, addLog } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (
    _request: NextRequest,
    _ctx
  ) => {
    try {
      const url = new URL(_request.url);
      const chatId = url.pathname.split('/').pop() || '';
      const decodedChatId = decodeURIComponent(chatId);
      const profile = await getContactProfile(decodedChatId);

      if (!profile) {
        return NextResponse.json({ message: 'Contact not found' }, { status: 404 });
      }

      return NextResponse.json(profile);
    } catch (error) {
      console.error('Failed to get contact profile:', error);
      return NextResponse.json({ message: 'Failed to fetch contact profile' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PUT = withApiAuth(
  async (
    request: NextRequest,
    ctx
  ) => {
    try {
      const url = new URL(request.url);
      const chatId = url.pathname.split('/').pop() || '';
      const decodedChatId = decodeURIComponent(chatId);
      const body = await request.json();

      const updated = await updateContactProfile(decodedChatId, body);

      dispatchWebhookEvent('contact.stage_changed', {
        chatId: decodedChatId,
        contact: updated,
        stage: updated.stage,
        tags: updated.tags,
        timestamp: Date.now(),
      }).catch((err) => console.error('Webhook dispatch error:', err));

      await addLog({
        user: ctx.userId || 'Agent',
        action: 'Contact Profile Updated',
        details: `Updated CRM profile for ${decodedChatId} (Stage: ${updated.stage}, Tags: ${updated.tags.join(', ') || 'none'})`,
        type: 'info',
      });

      return NextResponse.json(updated);
    } catch (error: any) {
      console.error('Failed to update contact profile:', error);
      return NextResponse.json({ message: error.message || 'Failed to update contact profile' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth(
  async (
    _request: NextRequest,
    ctx
  ) => {
    try {
      const url = new URL(_request.url);
      const chatId = url.pathname.split('/').pop() || '';
      const decodedChatId = decodeURIComponent(chatId);

      const { deleteContactProfiles } = await import('@/lib/db');
      const result = await deleteContactProfiles({ externalIds: [decodedChatId] });

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Contact Deleted',
        details: `Deleted CRM contact profile for ${decodedChatId}`,
        type: 'warning',
      });

      return NextResponse.json({ success: true, count: result.count });
    } catch (error: any) {
      console.error('Failed to delete contact profile:', error);
      return NextResponse.json({ message: error.message || 'Failed to delete contact profile' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

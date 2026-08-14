import { NextResponse } from 'next/server';
import { getContactProfile, updateContactProfile, addLog } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
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
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const decodedChatId = decodeURIComponent(chatId);
    const body = await request.json();

    const updated = await updateContactProfile(decodedChatId, body);

    dispatchWebhookEvent('contact.stage_changed', {
      chatId: decodedChatId,
      contact: updated,
      stage: updated.stage,
      tags: updated.tags,
      timestamp: Date.now(),
    }).catch(err => console.error('Webhook dispatch error:', err));

    await addLog({
      user: 'Agent',
      action: 'Contact Profile Updated',
      details: `Updated CRM profile for ${decodedChatId} (Stage: ${updated.stage}, Tags: ${updated.tags.join(', ') || 'none'})`,
      type: 'info',
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('Failed to update contact profile:', error);
    return NextResponse.json({ message: error.message || 'Failed to update contact profile' }, { status: 500 });
  }
}

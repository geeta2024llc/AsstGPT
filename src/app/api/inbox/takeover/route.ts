import { NextResponse } from 'next/server';
import { updateConversation, getAgents, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId, mode } = body;

    if (!chatId || !mode || (mode !== 'human' && mode !== 'ai')) {
      return NextResponse.json({ message: 'Invalid payload. Required chatId and mode ("human" | "ai").' }, { status: 400 });
    }

    if (mode === 'human') {
      await updateConversation(chatId, { assignedAgentId: '' });
      await addLog({
        user: 'Admin',
        action: 'Human Takeover Activated',
        details: `Human operator took over conversation ${chatId}`,
        type: 'info',
      });
      return NextResponse.json({ success: true, mode: 'human' });
    } else {
      const agents = await getAgents();
      const activeAgent = agents.find(a => a.status === 'active') || agents[0];
      await updateConversation(chatId, { assignedAgentId: activeAgent?.id || '' });
      await addLog({
        user: 'Admin',
        action: 'AI Auto-Reply Resumed',
        details: `Returned conversation ${chatId} to AI agent "${activeAgent?.name || 'Default'}"`,
        type: 'info',
      });
      return NextResponse.json({ success: true, mode: 'ai', agentId: activeAgent?.id });
    }
  } catch (error) {
    console.error('Failed to update conversation takeover status:', error);
    return NextResponse.json({ message: 'Failed to update takeover status' }, { status: 500 });
  }
}

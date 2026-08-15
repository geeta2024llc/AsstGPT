import { NextRequest, NextResponse } from 'next/server';
import { updateConversation, getAgents, addLog, getTeamMembers } from '@/lib/db';
import { generateTakeoverCatchUpSummary } from '@/lib/handoff-engine';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { chatId, mode, isPaused, assignedUserId, reason } = body;

      if (!chatId) {
        return NextResponse.json({ message: 'Missing required field: chatId' }, { status: 400 });
      }

      const shouldPause = mode ? mode === 'human' : (isPaused ?? true);

      if (shouldPause) {
        const teamMembers = await getTeamMembers();
        const assignedMember = assignedUserId ? teamMembers.find((m) => m.id === assignedUserId) : undefined;
        const memberName = assignedMember?.fullName || ctx.userId || 'Human Operator';

        const takeoverReason = reason || 'Manual human takeover activated from Inbox';

        await updateConversation(chatId, {
          isBotPaused: true,
          assignedUserId: assignedUserId || ctx.userId || undefined,
          handoffReason: takeoverReason,
          handoffAt: Date.now(),
        });

        // Generate instant catch-up briefing in parallel
        const briefing = await generateTakeoverCatchUpSummary(chatId, takeoverReason);

        await addLog({
          user: memberName,
          action: 'Human Takeover Activated',
          details: `Human takeover activated for ${chatId}. Assigned to: ${memberName}`,
          type: 'info',
        });

        return NextResponse.json({
          success: true,
          mode: 'human',
          isBotPaused: true,
          assignedUserId: assignedUserId || ctx.userId || null,
          takeoverBriefing: briefing,
        });
      } else {
        const agents = await getAgents();
        const activeAgent = agents.find((a) => a.status === 'active') || agents[0];

        await updateConversation(chatId, {
          isBotPaused: false,
          assignedAgentId: activeAgent?.id || '',
          handoffReason: undefined,
          handoffAt: undefined,
        });

        await addLog({
          user: ctx.userId || 'Admin',
          action: 'AI Auto-Reply Resumed',
          details: `Returned conversation ${chatId} to AI agent "${activeAgent?.name || 'Default'}"`,
          type: 'info',
        });

        return NextResponse.json({
          success: true,
          mode: 'ai',
          isBotPaused: false,
          agentId: activeAgent?.id,
        });
      }
    } catch (error) {
      console.error('Failed to update conversation takeover status:', error);
      return NextResponse.json({ message: 'Failed to update takeover status' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

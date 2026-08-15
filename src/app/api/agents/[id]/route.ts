import { NextRequest, NextResponse } from 'next/server';
import { updateAgent, deleteAgent, getAgent, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import type { Agent } from '@/types';

export const dynamic = 'force-dynamic';

function maskAgentApiKey(agent: Agent): Agent {
  if (agent.aiSettings?.apiKey) {
    const key = agent.aiSettings.apiKey;
    return {
      ...agent,
      aiSettings: {
        ...agent.aiSettings,
        apiKey: key.length > 8 ? `${key.slice(0, 4)}••••••••${key.slice(-4)}` : '••••••••',
      },
    };
  }
  return agent;
}

export const GET = withApiAuth(
  async (req: NextRequest) => {
    try {
      const url = new URL(req.url);
      const id = url.pathname.split('/').pop() || '';
      const agent = await getAgent(id);
      if (!agent) return NextResponse.json({ message: 'Not found' }, { status: 404 });
      return NextResponse.json(maskAgentApiKey(agent));
    } catch (error) {
      console.error('Failed to fetch agent:', error);
      return NextResponse.json({ message: 'Failed' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PATCH = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.split('/').pop() || '';
      const body = (await request.json()) as Partial<Omit<Agent, 'id'>>;

      if (body.mode === 'ai') {
        if (!body.aiSettings) {
          return NextResponse.json({ message: 'AI settings are required for AI mode agents.' }, { status: 400 });
        }
        if (!('rules' in body)) {
          (body as any).rules = [];
        }
      }

      await updateAgent(id, body);
      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Updated Agent',
        details: `Agent ${id} updated.`,
        type: 'info',
      });
      const updated = await getAgent(id);
      return NextResponse.json(updated);
    } catch (error) {
      console.error('Failed to update agent:', error);
      return NextResponse.json({ message: 'Failed to update agent' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth(
  async (req: NextRequest, ctx) => {
    try {
      const url = new URL(req.url);
      const id = url.pathname.split('/').pop() || '';
      await deleteAgent(id);
      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Deleted Agent',
        details: `Agent ${id} deleted.`,
        type: 'warning',
      });
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Failed to delete agent:', error);
      return NextResponse.json({ message: 'Failed to delete agent' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

import { NextResponse } from 'next/server';
import { updateAgent, deleteAgent, getAgent, addLog } from '@/lib/db';
import type { Agent } from '@/types';

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);
    if (!agent) return NextResponse.json({ message: 'Not found' }, { status: 404 });
    return NextResponse.json(maskAgentApiKey(agent));
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return NextResponse.json({ message: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<Omit<Agent, 'id'>>;
    console.log('Updating agent:', id, 'with body:', body);
    
    // For AI mode, validate and ensure proper structure
    if (body.mode === 'ai') {
      console.log('Processing AI mode agent update');
      
      // Ensure aiSettings exists
      if (!body.aiSettings) {
        return NextResponse.json({ message: 'AI settings are required for AI mode agents.' }, { status: 400 });
      }
      
      // Ensure rules array exists for AI mode to satisfy type shape
      if (!('rules' in body)) {
        (body as any).rules = [];
      }
    }
    await updateAgent(id, body);
    await addLog({
      user: 'Admin',
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
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteAgent(id);
    await addLog({
      user: 'Admin',
      action: 'Deleted Agent',
      details: `Agent ${id} deleted.`,
      type: 'warning',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return NextResponse.json({ message: 'Failed to delete agent' }, { status: 500 });
  }
}

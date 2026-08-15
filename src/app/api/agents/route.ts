
import { NextResponse } from 'next/server';
import { addAgent, getAgents, addLog } from '@/lib/db';
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

export async function GET() {
  try {
    const agents = await getAgents();
    const masked = agents.map(maskAgentApiKey);
    return NextResponse.json(masked);
  } catch (error) {
    console.error('Failed to get agents:', error);
    return NextResponse.json({ message: 'Failed to get agents' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<Omit<Agent, 'id'>>;
    if (!body.mode) body.mode = 'rule';

    // Basic validation
    if (!body.name) {
      return NextResponse.json({ message: 'Agent name is required.' }, { status: 400 });
    }

    // Only validate rules for rule-based agents
    if (body.mode === 'rule' && (!body.rules || body.rules.length === 0)) {
      return NextResponse.json({ message: 'At least one rule is required for rule-based agents.' }, { status: 400 });
    }

    // For AI mode, validate AI settings
    if (body.mode === 'ai') {
      console.log('Processing AI mode agent:', body);
      
      // Ensure aiSettings exists
      if (!body.aiSettings) {
        return NextResponse.json({ message: 'AI settings are required for AI mode agents.' }, { status: 400 });
      }
      
      // Ensure rules array exists for AI mode to satisfy type shape
      if (!('rules' in body)) {
        (body as any).rules = [];
      }
    }

    const newAgent = await addAgent(body as any);
    
    await addLog({
      user: 'Admin',
      action: 'Created Agent',
      details: `New agent named "${newAgent.name}" was created.`,
      type: 'success',
    });

    return NextResponse.json(newAgent, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    await addLog({
        user: 'System',
        action: 'Agent Creation Failed',
        details: (error as Error).message,
        type: 'error',
    });
    return NextResponse.json({ message: 'Failed to create agent' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getHandoffRules, createHandoffRule, addLog } from '@/lib/db';
import type { HandoffRule } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rules = await getHandoffRules();
    return NextResponse.json(rules);
  } catch (error) {
    console.error('Failed to fetch handoff rules:', error);
    return NextResponse.json({ message: 'Failed to fetch handoff rules' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, isEnabled, ruleType, conditions, actions, priority } = body;

    if (!name || !ruleType) {
      return NextResponse.json(
        { message: 'Missing required fields: name and ruleType' },
        { status: 400 }
      );
    }

    const newRule = await createHandoffRule({
      name,
      description: description || '',
      isEnabled: isEnabled !== false,
      ruleType,
      conditions: conditions || {},
      actions: actions || { autoPauseAi: true },
      priority: typeof priority === 'number' ? priority : 50,
    });

    await addLog({
      user: 'Admin',
      action: 'Handoff Rule Created',
      details: `Created handoff rule "${name}" (type: ${ruleType})`,
      type: 'info',
    });

    return NextResponse.json(newRule, { status: 201 });
  } catch (error) {
    console.error('Failed to create handoff rule:', error);
    return NextResponse.json({ message: 'Failed to create handoff rule' }, { status: 500 });
  }
}

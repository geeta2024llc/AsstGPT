import { NextResponse } from 'next/server';
import { getCannedResponses, createCannedResponse, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const list = await getCannedResponses();
    return NextResponse.json(list);
  } catch (error) {
    console.error('Failed to get canned responses:', error);
    return NextResponse.json({ message: 'Failed to fetch canned responses' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, shortcut, content, category } = body;

    if (!title || !shortcut || !content) {
      return NextResponse.json(
        { message: 'Missing required fields: title, shortcut, and content' },
        { status: 400 }
      );
    }

    const created = await createCannedResponse({
      title,
      shortcut,
      content,
      category: category || 'general',
    });

    await addLog({
      user: 'Admin',
      action: 'Canned Response Created',
      details: `Created quick reply shortcut "/${created.shortcut}" (${title})`,
      type: 'info',
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create canned response:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to create canned response' },
      { status: 500 }
    );
  }
}

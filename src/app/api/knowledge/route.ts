import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeFiles, addKnowledgeFile, updateKnowledgeFile, deleteKnowledgeFile, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const files = await getKnowledgeFiles();
      return NextResponse.json(files);
    } catch (error) {
      console.error('Failed to get knowledge files:', error);
      return NextResponse.json({ message: 'Failed to get knowledge files' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { fileName, fileType, content, enabled } = body;

      if (!fileName || !content) {
        return NextResponse.json({ message: 'Title and content are required.' }, { status: 400 });
      }

      const newFile = await addKnowledgeFile({
        fileName,
        fileType: fileType || 'faq',
        size: Buffer.byteLength(content, 'utf-8'),
        content,
        enabled: enabled !== false,
        status: 'ready',
      });

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Created Knowledge Source',
        details: `Added knowledge source "${fileName}" (${fileType || 'faq'}).`,
        type: 'info',
      });

      return NextResponse.json(newFile, { status: 201 });
    } catch (error) {
      console.error('Failed to create knowledge file:', error);
      return NextResponse.json({ message: (error as Error).message }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const PATCH = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { id, fileName, fileType, content, enabled, status } = body;

      if (!id) {
        return NextResponse.json({ message: 'Knowledge source ID is required.' }, { status: 400 });
      }

      const updateData: any = {};
      if (fileName !== undefined) updateData.fileName = fileName;
      if (fileType !== undefined) updateData.fileType = fileType;
      if (content !== undefined) {
        updateData.content = content;
        updateData.size = Buffer.byteLength(content, 'utf-8');
      }
      if (enabled !== undefined) updateData.enabled = enabled;
      if (status !== undefined) updateData.status = status;

      await updateKnowledgeFile(id, updateData);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Updated Knowledge Source',
        details: `Updated knowledge source ID "${id}". Enabled: ${enabled ?? 'unchanged'}, Status: ${status ?? 'ready'}`,
        type: 'info',
      });

      return NextResponse.json({ message: 'Knowledge source updated successfully.' });
    } catch (error) {
      console.error('Failed to update knowledge file:', error);
      return NextResponse.json({ message: (error as Error).message }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');

      if (!id) {
        return NextResponse.json({ message: 'File ID is required.' }, { status: 400 });
      }

      const files = await getKnowledgeFiles();
      const fileToDelete = files.find(f => f.id === id);

      await deleteKnowledgeFile(id);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Deleted Knowledge Source',
        details: `Knowledge source "${fileToDelete?.fileName || id}" was deleted.`,
        type: 'info',
      });

      return NextResponse.json({ message: 'Knowledge source deleted successfully.' }, { status: 200 });
    } catch (error) {
      console.error('Failed to delete knowledge file:', error);
      await addLog({
        user: 'System',
        action: 'Knowledge Deletion Failed',
        details: (error as Error).message,
        type: 'error',
      });
      return NextResponse.json({ message: 'Failed to delete knowledge file' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

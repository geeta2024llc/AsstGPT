
import { NextResponse } from 'next/server';
import { addKnowledgeFile, addLog } from '@/lib/db';
import type { KnowledgeFile } from '@/types';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Since we're using the legacy build, we must provide the worker.
// This is a workaround for Next.js environments.
// @ts-ignore
await import('pdfjs-dist/build/pdf.worker.mjs');

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
        return NextResponse.json({ message: 'No file uploaded.' }, { status: 400 });
    }

    const fileName = file.name;
    const fileType = file.name.split('.').pop()?.toLowerCase() || '';
    const size = file.size;
    
    const bytes = await file.arrayBuffer();
    
    let content = '';

    if (fileType === 'pdf') {
      const doc = await pdfjs.getDocument(bytes).promise;
      let fullText = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
        fullText += pageText + '\n\n';
      }
      content = fullText;
    } else if (fileType === 'docx') {
      const buffer = Buffer.from(bytes);
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else if (fileType === 'txt') {
      const buffer = Buffer.from(bytes);
      content = buffer.toString('utf-8');
    } else {
      throw new Error('Unsupported file type. Please use PDF, DOCX, or TXT.');
    }

    if (!content.trim()) {
      throw new Error('Could not extract any text from the document. The file might be empty or scanned as an image.');
    }

    const fileData: Omit<KnowledgeFile, 'id' | 'createdAt'> = {
      fileName,
      fileType,
      size,
      content,
    };
    
    const newFile = await addKnowledgeFile(fileData);
    
    await addLog({
      user: 'Admin',
      action: 'Uploaded Document',
      details: `File "${newFile.fileName}" was uploaded.`,
      type: 'success',
    });

    return NextResponse.json(newFile, { status: 201 });
  } catch (error) {
    console.error('Failed to parse or create knowledge file:', error);
    await addLog({
        user: 'System',
        action: 'Document Upload Failed',
        details: (error as Error).message,
        type: 'error',
    });
    return NextResponse.json({ message: (error as Error).message || 'Failed to create knowledge file' }, { status: 500 });
  }
}

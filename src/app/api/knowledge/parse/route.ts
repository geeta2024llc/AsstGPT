import { NextRequest, NextResponse } from 'next/server';
import { addKnowledgeFile, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import type { KnowledgeFile } from '@/types';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export const dynamic = 'force-dynamic';

// Max allowed file size (10 MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ message: 'No file uploaded.' }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { message: `File size exceeds the 10MB limit (Uploaded: ${(file.size / 1024 / 1024).toFixed(1)}MB)` },
          { status: 400 }
        );
      }

      const fileName = file.name;
      const fileType = file.name.split('.').pop()?.toLowerCase() || '';
      const size = file.size;

      const bytes = await file.arrayBuffer();
      let content = '';

      if (fileType === 'pdf') {
        const doc = await pdfjs.getDocument(bytes).promise;
        let fullText = '';
        for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
          const page = await doc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');
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
        return NextResponse.json(
          { message: 'Unsupported file type. Please upload a PDF, DOCX, or TXT document.' },
          { status: 400 }
        );
      }

      if (!content.trim()) {
        return NextResponse.json(
          { message: 'Could not extract text from document. File may be empty or scanned image.' },
          { status: 400 }
        );
      }

      const fileData: Omit<KnowledgeFile, 'id' | 'createdAt'> = {
        fileName,
        fileType,
        size,
        content: content.slice(0, 500000), // Cap extracted text to 500k chars
      };

      const newFile = await addKnowledgeFile(fileData);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Uploaded Document',
        details: `File "${newFile.fileName}" was uploaded.`,
        type: 'success',
      });

      return NextResponse.json(newFile, { status: 201 });
    } catch (error: any) {
      console.error('Failed to parse or create knowledge file:', error);
      return NextResponse.json({ message: error.message || 'Failed to create knowledge file' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

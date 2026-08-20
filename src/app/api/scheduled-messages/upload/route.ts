import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-guard';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/3gpp',
  'video/quicktime',
]);

export const POST = withApiAuth(
  async (request: NextRequest) => {
    try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
      }

      const mimeType = file.type || 'application/octet-stream';
      const isVideo = mimeType.startsWith('video/');
      const isImage = mimeType.startsWith('image/');

      if (!ALLOWED_MIME_TYPES.has(mimeType) && !isImage && !isVideo) {
        return NextResponse.json(
          { error: `Unsupported media type: ${mimeType}. Please upload JPEG, PNG, WebP image or MP4 video.` },
          { status: 400 }
        );
      }

      const maxAllowed = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
      if (file.size > maxAllowed) {
        const maxMb = (maxAllowed / (1024 * 1024)).toFixed(0);
        return NextResponse.json(
          { error: `File size exceeds the maximum limit of ${maxMb} MB.` },
          { status: 400 }
        );
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Ensure directory exists
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'scheduled');
      await fs.mkdir(uploadDir, { recursive: true });

      // Clean sanitized file name
      const ext = path.extname(file.name) || (isVideo ? '.mp4' : '.jpg');
      const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const uniqueSuffix = crypto.randomBytes(6).toString('hex');
      const targetFileName = `${Date.now()}_${uniqueSuffix}_${baseName}${ext}`;
      const targetFilePath = path.join(uploadDir, targetFileName);

      await fs.writeFile(targetFilePath, buffer);

      const publicUrl = `/uploads/scheduled/${targetFileName}`;

      return NextResponse.json({
        url: publicUrl,
        fileName: file.name,
        mimeType: mimeType,
        size: file.size,
        type: isVideo ? 'video' : 'image',
      });
    } catch (error: any) {
      console.error('File upload failed:', error);
      return NextResponse.json(
        { error: error.message || 'File upload failed' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);

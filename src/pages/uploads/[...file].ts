/**
 * Uploads Static File Server
 *
 * Serves uploaded files from /data/uploads/ directory.
 * Handles logos and other user-uploaded assets.
 */

import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UPLOAD_DIR = '/data/uploads';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const GET: APIRoute = async ({ params }) => {
  const filename = params.file || '';

  if (!filename) {
    return new Response('File not found', { status: 404 });
  }

  const filepath = path.join(UPLOAD_DIR, filename);

  // Security: Prevent directory traversal
  if (!filepath.startsWith(UPLOAD_DIR)) {
    return new Response('Invalid file path', { status: 403 });
  }

  // Check if file exists
  if (!existsSync(filepath)) {
    return new Response('File not found', { status: 404 });
  }

  try {
    const buffer = await readFile(filepath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 1 year cache
      },
    });

  } catch (error) {
    console.error('[Uploads] Error serving file:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

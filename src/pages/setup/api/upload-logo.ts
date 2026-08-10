/**
 * Logo Upload API - Setup Wizard
 *
 * Handles logo file uploads during initial setup.
 * Files saved to /data/uploads/ (persistent across container restarts).
 */

import type { APIRoute } from 'astro';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UPLOAD_DIR = '/data/uploads';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/jpg'];

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('logo') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid file type. Only PNG, SVG, and JPEG are allowed.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          error: 'File too large. Maximum size is 2MB.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const ext = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1];
    const filename = `logo-${timestamp}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Write file to disk
    const buffer = await file.arrayBuffer();
    await writeFile(filepath, Buffer.from(buffer));

    // Return URL (relative to serve from /uploads/)
    const logoUrl = `/uploads/${filename}`;

    return new Response(
      JSON.stringify({ logoUrl }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Logo Upload] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to upload logo. Please try again.'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

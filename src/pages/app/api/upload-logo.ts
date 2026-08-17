/**
 * Logo Upload API - Settings Page
 *
 * Handles logo file uploads from the settings page.
 * Files saved to /data/uploads/ (persistent across container restarts).
 */

import type { APIRoute } from 'astro';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logAudit, getClientIp } from '../../../lib/audit';

const UPLOAD_DIR = '/data/uploads';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/jpg'];

export const POST: APIRoute = async ({ request, locals }) => {
  // Verify user is authenticated
  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('logo') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type (MIME can be spoofed)
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

    // SECURITY FIX (2026-08-16): Validate file magic bytes (MIME type can be spoofed)
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let isValidType = false;

    // Check PNG magic bytes: 89 50 4E 47
    if (file.type === 'image/png') {
      isValidType = bytes.length >= 4 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4E && bytes[3] === 0x47;
    }
    // Check JPEG magic bytes: FF D8 FF
    else if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      isValidType = bytes.length >= 3 &&
        bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    }
    // Check SVG (starts with < and contains <svg)
    else if (file.type === 'image/svg+xml') {
      const svgText = new TextDecoder().decode(bytes);
      isValidType = svgText.trim().startsWith('<') && svgText.includes('<svg');

      // SECURITY: Block SVG with <script> tags
      if (isValidType && /<script[\s>]/i.test(svgText)) {
        return new Response(
          JSON.stringify({
            error: 'SVG files with script tags are not allowed for security reasons.'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!isValidType) {
      return new Response(
        JSON.stringify({
          error: 'File content does not match declared type. Upload may be corrupted or malicious.'
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

    // Write file to disk (buffer already loaded for magic byte validation)
    await writeFile(filepath, Buffer.from(buffer));

    // SECURITY FIX (2026-08-16): Audit logging for file uploads
    logAudit('file_upload', {
      userId: locals.user.id,
      ip: getClientIp(request),
      details: {
        filename,
        type: file.type,
        size: file.size,
        path: filepath,
        success: true
      }
    });

    // Return URL (relative to serve from /uploads/)
    const logoUrl = `/uploads/${filename}`;

    return new Response(
      JSON.stringify({ logoUrl }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Logo Upload] Error:', error);

    // SECURITY FIX (2026-08-16): Audit logging for failed uploads
    logAudit('file_upload_failed', {
      userId: locals.user?.id,
      ip: getClientIp(request),
      details: {
        error: error instanceof Error ? error.message : String(error),
        success: false
      }
    });

    return new Response(
      JSON.stringify({
        error: 'Failed to upload logo. Please try again.'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

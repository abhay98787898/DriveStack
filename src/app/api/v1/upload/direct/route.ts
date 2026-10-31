import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { validateApiKey, isDomainAllowed } from '@/lib/api-key';
import { createResumableUploadSession } from '@/lib/gdrive';
import { db } from '@/lib/db';
import { isAllowedImageMimeType, MAX_IMAGE_SIZE_BYTES, sanitizeImageName } from '@/lib/image-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getApiKeyFromHeaders(headers: Headers): string | null {
  const authHeader = headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7).trim();
  }
  const xApiKey = headers.get('x-api-key');
  if (xApiKey) {
    return xApiKey.trim();
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const rawKey = getApiKeyFromHeaders(request.headers);
    if (!rawKey) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Missing API key in Authorization or x-api-key header' },
        { status: 401 }
      );
    }

    const keyRecord = await validateApiKey(rawKey);
    if (!keyRecord) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or revoked API key' },
        { status: 401 }
      );
    }

    const clientOrigin = request.headers.get('origin') || request.headers.get('referer') || undefined;
    if (!isDomainAllowed(keyRecord.allowedDomains, clientOrigin || null)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Request origin is not permitted by API key domain policy' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, mime_type, size, folder } = body;

    if (typeof name !== 'string' || typeof mime_type !== 'string' || size === undefined || size === null) {
      return NextResponse.json(
        { success: false, error: 'Bad Request: "name", "mime_type", and "size" are required' },
        { status: 400 }
      );
    }

    const sizeBytes = Number(size);
    if (!isAllowedImageMimeType(mime_type)) {
      return NextResponse.json({ success: false, error: 'Unsupported image MIME type' }, { status: 415 });
    }
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: 'Image size must be between 1 byte and 25 MB' }, { status: 413 });
    }
    const safeName = sanitizeImageName(name);
    const session = await createResumableUploadSession(
      keyRecord.accountId,
      safeName,
      mime_type.toLowerCase(),
      sizeBytes,
      folder,
      clientOrigin
    );

    // Pre-create asset entry in database
    const asset = await db.asset.create({
      data: {
        accountId: keyRecord.accountId,
        createdByKeyId: keyRecord.id,
        name: safeName,
        googleFileId: `pending_${nanoid()}`,
        mimeType: mime_type.toLowerCase(),
        sizeBytes,
      },
    });

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const mediaUrl = `${appUrl}/media/${asset.id}`;

    return NextResponse.json({
      success: true,
      asset_id: asset.id,
      upload_url: session.uploadUrl,
      media_url: mediaUrl,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to initialize direct upload session' },
      { status: 500 }
    );
  }
}

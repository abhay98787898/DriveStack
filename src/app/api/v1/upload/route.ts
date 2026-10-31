import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { inspectImageUpload, sanitizeImageName, ImageUploadError, MAX_IMAGE_SIZE_BYTES } from '@/lib/image-upload';
import { validateApiKey, isDomainAllowed } from '@/lib/api-key';
import { uploadStreamToDrive } from '@/lib/gdrive';
import { db } from '@/lib/db';
import { getPublicAppUrl } from '@/lib/public-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

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
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const keyRecord = await validateApiKey(rawKey);
    if (!keyRecord) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or revoked API key' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const origin = request.headers.get('origin') || request.headers.get('referer');
    if (!isDomainAllowed(keyRecord.allowedDomains, origin)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Request origin is not permitted by API key domain policy' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_SIZE_BYTES + 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Request exceeds the 25 MB image upload limit' }, { status: 413, headers: CORS_HEADERS });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string | null) || undefined;
    const customName = formData.get('name') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Bad Request: "file" form-data field is required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const mimeType = (file.type || '').toLowerCase();
    const filename = sanitizeImageName(customName || file.name || 'image');
    const buffer = Buffer.from(await file.arrayBuffer());
    const sizeBytes = buffer.length;
    const metadata = await inspectImageUpload(buffer, mimeType);
    const { width, height } = metadata;

    const stream = Readable.from(buffer);

    const uploadResult = await uploadStreamToDrive(
      keyRecord.accountId,
      filename,
      mimeType,
      stream,
      folder
    );

    const asset = await db.asset.create({
      data: {
        accountId: keyRecord.accountId,
        createdByKeyId: keyRecord.id,
        name: filename,
        googleFileId: uploadResult.fileId,
        mimeType,
        sizeBytes,
        width,
        height,
      },
    });

    await db.googleAccount.update({
      where: { id: keyRecord.accountId },
      data: {
        storageUsed: { increment: BigInt(sizeBytes) },
      },
    });

    const appUrl = getPublicAppUrl();
    const publicUrl = `${appUrl}/media/${asset.id}`;

    return NextResponse.json(
      {
        success: true,
        asset_id: asset.id,
        name: asset.name,
        mime_type: asset.mimeType,
        size: asset.sizeBytes,
        url: publicUrl,
        created_at: asset.createdAt.toISOString(),
      },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error: unknown) {
    const status = error instanceof ImageUploadError ? error.status : 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status, headers: CORS_HEADERS }
    );
  }
}

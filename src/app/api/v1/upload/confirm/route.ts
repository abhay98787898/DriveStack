import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, isDomainAllowed } from '@/lib/api-key';
import { verifyUploadedFile, downloadStreamFromDrive } from '@/lib/gdrive';
import { db } from '@/lib/db';
import { inspectImageUpload, isAllowedImageMimeType, ImageUploadError } from '@/lib/image-upload';
import { getPublicAppUrl } from '@/lib/public-url';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

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
        { success: false, error: 'Unauthorized: Missing API key' },
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

    const rate = checkRateLimit(keyRecord.id, 'upload', 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(rateLimitResponse(rate.retryAfterSeconds), {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      });
    }

    const origin = request.headers.get('origin') || request.headers.get('referer');
    if (!isDomainAllowed(keyRecord.allowedDomains, origin)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Request origin is not permitted by API key domain policy' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { asset_id, google_file_id } = body;

    if (
      typeof asset_id !== 'string' ||
      typeof google_file_id !== 'string' ||
      !asset_id.trim() ||
      !google_file_id.trim() ||
      google_file_id.length > 256 ||
      google_file_id.startsWith('pending_')
    ) {
      return NextResponse.json(
        { success: false, error: 'Bad Request: valid "asset_id" and "google_file_id" are required' },
        { status: 400 }
      );
    }

    // A key may only confirm a pending upload created by that same key
    // and stored under the Google account attached to that key.
    const asset = await db.asset.findFirst({
      where: {
        id: asset_id,
        accountId: keyRecord.accountId,
        createdByKeyId: keyRecord.id,
        googleFileId: { startsWith: 'pending_' },
      },
    });

    if (!asset) {
      return NextResponse.json(
        { success: false, error: 'Pending upload not found for this API key' },
        { status: 404 }
      );
    }

    if (!isAllowedImageMimeType(asset.mimeType)) {
      return NextResponse.json({ success: false, error: 'Pending upload is not an allowed image type' }, { status: 415 });
    }

    // Verify the uploaded file belongs to this account's DriveStack folder.
    // It remains private in Google Drive; delivery happens through /media/{id}.
    await verifyUploadedFile(
      keyRecord.accountId,
      google_file_id,
      asset.sizeBytes,
      asset.mimeType
    );

    // Resumable uploads bypass the application server while transferring bytes.
    // Inspect the stored bytes at confirmation time so MIME headers cannot spoof
    // an executable or malformed file as an image.
    const uploadedMedia = await downloadStreamFromDrive(keyRecord.accountId, google_file_id);
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    for await (const chunk of uploadedMedia.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > asset.sizeBytes || receivedBytes > 25 * 1024 * 1024) {
        uploadedMedia.stream.destroy();
        throw new ImageUploadError('Uploaded image exceeds the permitted size', 413);
      }
      chunks.push(buffer);
    }
    if (receivedBytes !== asset.sizeBytes) {
      throw new ImageUploadError('Uploaded image size does not match the upload session', 400);
    }
    const inspected = await inspectImageUpload(Buffer.concat(chunks), asset.mimeType);
    if (inspected.mimeType !== asset.mimeType) {
      throw new ImageUploadError('Uploaded image format does not match the declared MIME type', 415);
    }

    const updated = await db.$transaction(async (tx) => {
      const updateResult = await tx.asset.updateMany({
        where: {
          id: asset.id,
          accountId: keyRecord.accountId,
          createdByKeyId: keyRecord.id,
          googleFileId: { startsWith: 'pending_' },
        },
        data: { googleFileId: google_file_id },
      });

      if (updateResult.count !== 1) {
        throw new Error('UPLOAD_CONFIRM_CONFLICT');
      }

      await tx.googleAccount.update({
        where: { id: keyRecord.accountId },
        data: { storageUsed: { increment: BigInt(asset.sizeBytes) } },
      });

      return tx.asset.findUniqueOrThrow({ where: { id: asset.id } });
    });

    const appUrl = getPublicAppUrl();
    const mediaUrl = `${appUrl}/media/${updated.id}`;

    return NextResponse.json({
      success: true,
      asset_id: updated.id,
      name: updated.name,
      size: updated.sizeBytes,
      mime_type: updated.mimeType,
      url: mediaUrl,
    });
  } catch (error: unknown) {
    const status = error instanceof ImageUploadError
      ? error.status
      : error instanceof Error && error.message === 'UPLOAD_CONFIRM_CONFLICT'
        ? 409
        : 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error
        ? (error.message === 'UPLOAD_CONFIRM_CONFLICT' ? 'Upload confirmation has already been processed or is not permitted' : error.message)
        : 'Failed to confirm upload' },
      { status }
    );
  }
}

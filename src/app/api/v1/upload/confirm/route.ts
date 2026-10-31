import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, isDomainAllowed } from '@/lib/api-key';
import { verifyUploadedFile } from '@/lib/gdrive';
import { db } from '@/lib/db';

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

    // Verify the uploaded file belongs to this account's DriveStack folder.
    // It remains private in Google Drive; delivery happens through /media/{id}.
    await verifyUploadedFile(
      keyRecord.accountId,
      google_file_id,
      asset.sizeBytes,
      asset.mimeType
    );

    const updateResult = await db.asset.updateMany({
      where: {
        id: asset.id,
        accountId: keyRecord.accountId,
        createdByKeyId: keyRecord.id,
        googleFileId: { startsWith: 'pending_' },
      },
      data: {
        googleFileId: google_file_id,
      },
    });

    if (updateResult.count !== 1) {
      return NextResponse.json(
        { success: false, error: 'Upload confirmation has already been processed or is not permitted' },
        { status: 409 }
      );
    }

    const updated = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });

    // Update storage usage only after the asset has been confirmed.
    await db.googleAccount.update({
      where: { id: keyRecord.accountId },
      data: {
        storageUsed: { increment: BigInt(asset.sizeBytes) },
      },
    });

    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const mediaUrl = `${protocol}://${host}/media/${updated.id}`;

    return NextResponse.json({
      success: true,
      asset_id: updated.id,
      name: updated.name,
      size: updated.sizeBytes,
      mime_type: updated.mimeType,
      url: mediaUrl,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to confirm upload' },
      { status: 500 }
    );
  }
}

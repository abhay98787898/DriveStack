import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteFileFromDrive } from '@/lib/gdrive';
import { getOwnerSession } from '@/lib/auth-guard';
import { getPublicAppUrl } from '@/lib/public-url';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rate = checkRateLimit(session.user.id, 'asset-detail', 120, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(rateLimitResponse(rate.retryAfterSeconds), {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      });
    }

    const { id } = await params;
    const asset = await db.asset.findFirst({
      where: { id, account: { is: { ownerUserId: session.user.id } } },
    });

    if (!asset) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    const appUrl = getPublicAppUrl();

    return NextResponse.json({
      success: true,
      data: {
        id: asset.id,
        name: asset.name,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        url: `${appUrl}/media/${asset.id}`,
        created_at: asset.createdAt.toISOString(),
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rate = checkRateLimit(session.user.id, 'asset-delete', 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(rateLimitResponse(rate.retryAfterSeconds), {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      });
    }

    const { id } = await params;
    const asset = await db.asset.findFirst({
      where: { id, account: { is: { ownerUserId: session.user.id } } },
    });

    if (!asset) {
      return NextResponse.json(
        { success: false, error: 'Asset not found' },
        { status: 404 }
      );
    }

    // Keep the database record if Google Drive deletion fails, so the owner
    // can retry instead of silently losing track of a still-stored file.
    await deleteFileFromDrive(asset.accountId, asset.googleFileId);

    // Remove metadata and decrement the usage counter atomically.
    await db.$transaction(async (tx) => {
      await tx.asset.delete({ where: { id: asset.id } });
      await tx.googleAccount.update({
        where: { id: asset.accountId },
        data: { storageUsed: { decrement: BigInt(asset.sizeBytes) } },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

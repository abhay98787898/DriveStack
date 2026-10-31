import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteFileFromDrive } from '@/lib/gdrive';
import { getOwnerSession } from '@/lib/auth-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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

    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';

    return NextResponse.json({
      success: true,
      data: {
        id: asset.id,
        name: asset.name,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        url: `${protocol}://${host}/media/${asset.id}`,
        created_at: asset.createdAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
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

    // Delete from Google Drive
    try {
      await deleteFileFromDrive(asset.accountId, asset.googleFileId);
    } catch {
      // Continue deleting from DB even if remote file was already manually removed
    }

    // Delete from DB
    await db.asset.delete({
      where: { id: asset.id },
    });

    // Update storage usage
    await db.googleAccount.update({
      where: { id: asset.accountId },
      data: {
        storageUsed: { decrement: BigInt(asset.sizeBytes) },
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully',
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

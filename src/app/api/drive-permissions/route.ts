import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOwnerSession } from '@/lib/auth-guard';
import { listAnyonePermissionsForAsset, listImagesInMediaFolder, revokeAnyonePermissionFromAsset } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';


export async function POST(request: NextRequest) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'audit' && action !== 'revoke') {
      return NextResponse.json({ success: false, error: 'action must be audit or revoke' }, { status: 400 });
    }
    if (action === 'revoke' && body?.confirmation !== 'REVOKE_PUBLIC_LINKS') {
      return NextResponse.json(
        { success: false, error: 'Explicit confirmation required: REVOKE_PUBLIC_LINKS' },
        { status: 400 }
      );
    }

    const cursor = typeof body?.cursor === 'string' && body.cursor.length <= 200 ? body.cursor : undefined;
    const accounts = await db.googleAccount.findMany({
      where: { ownerUserId: session.user.id },
      orderBy: { id: 'asc' },
      select: { id: true, email: true },
    });
    const cursorIndex = cursor ? accounts.findIndex((account) => account.id === cursor) : -1;
    if (cursor && cursorIndex < 0) {
      return NextResponse.json({ success: false, error: 'Invalid account cursor' }, { status: 400 });
    }
    const startIndex = cursor ? cursorIndex + 1 : 0;
    const page = accounts.slice(startIndex, startIndex + 1);
    const hasMore = startIndex + page.length < accounts.length;
    const results: Array<{ assetId: string; name: string; accountEmail: string; publicPermissionCount?: number; revokedCount?: number; error?: string }> = [];
    let processed = 0;

    for (const account of page) {
      const images = await listImagesInMediaFolder(account.id);
      for (const image of images) {
        processed += 1;
        try {
          if (action === 'audit') {
            const permissions = await listAnyonePermissionsForAsset(account.id, image.id);
            if (permissions.length) {
              results.push({ assetId: image.id, name: image.name, accountEmail: account.email, publicPermissionCount: permissions.length });
            }
          } else {
            const revokedCount = await revokeAnyonePermissionFromAsset(account.id, image.id);
            if (revokedCount) results.push({ assetId: image.id, name: image.name, accountEmail: account.email, revokedCount });
          }
        } catch (error: unknown) {
          results.push({ assetId: image.id, name: image.name, accountEmail: account.email, error: error instanceof Error ? error.message : 'Unknown Google Drive permission error' });
        }
      }
    }

    return NextResponse.json({
      success: true,
      action,
      processed,
      results,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
      ...(action === 'revoke' ? { note: 'Only anyone-type permissions on verified images inside the DriveStack media folder or its direct subfolders are removed. Other permissions are untouched.' } : {}),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

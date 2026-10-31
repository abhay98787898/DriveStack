import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOwnerSession } from '@/lib/auth-guard';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function GET(request: Request) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rate = checkRateLimit(session.user.id, 'storage-read', 60, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(rateLimitResponse(rate.retryAfterSeconds), {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      });
    }

    const account = await db.googleAccount.findFirst({
      where: { ownerUserId: session.user.id },
      orderBy: { createdAt: 'asc' },
    });

    if (!account) {
      return NextResponse.json({
        connected: false,
        email: null,
        storage_used_bytes: 0,
        storage_limit_bytes: 0,
        used_formatted: '0 B',
        limit_formatted: '0 B',
        percentage: 0,
        percentage_label: '0%',
      });
    }

    const used = Number(account.storageUsed);
    const limit = Number(account.storageLimit);
    const percentage = limit > 0 ? (used / limit) * 100 : 0;

    let percentageLabel = `${percentage.toFixed(2)}%`;
    if (percentage > 0 && percentage < 0.01) {
      percentageLabel = `${percentage.toFixed(4)}%`;
    }

    return NextResponse.json({
      connected: true,
      email: account.email,
      storage_used_bytes: used,
      storage_limit_bytes: limit,
      used_formatted: formatBytes(used),
      limit_formatted: formatBytes(limit),
      percentage: Math.min(100, percentage),
      percentage_label: percentageLabel,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch storage info' },
      { status: 500 }
    );
  }
}

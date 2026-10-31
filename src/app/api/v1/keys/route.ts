import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createApiKey } from '@/lib/api-key';
import { decrypt } from '@/lib/encryption';
import { getOwnerSession } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const keys = await db.apiKey.findMany({
      where: { account: { is: { ownerUserId: session.user.id } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        encryptedKey: true,
        allowedDomains: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    const formatted = keys.map((k) => {
      let fullKey: string | null = null;
      if (k.encryptedKey) {
        try {
          fullKey = decrypt(k.encryptedKey);
        } catch {}
      }
      return {
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        fullKey,
        allowedDomains: k.allowedDomains,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: formatted,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, allowed_domains } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Bad Request: "name" is required' },
        { status: 400 }
      );
    }

    // Retrieve active Google account
    const account = await db.googleAccount.findFirst({ where: { ownerUserId: session.user.id }, orderBy: { createdAt: 'asc' } });
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'No Google account connected. Please connect Google Drive first.' },
        { status: 400 }
      );
    }

    const createdKey = await createApiKey(account.id, name, allowed_domains);

    return NextResponse.json(
      {
        success: true,
        data: createdKey,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Bad Request: "id" query parameter is required' },
        { status: 400 }
      );
    }

    const deleted = await db.apiKey.deleteMany({
      where: {
        id,
        account: { is: { ownerUserId: session.user.id } },
      },
    });

    if (deleted.count !== 1) {
      return NextResponse.json(
        { success: false, error: 'API key not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

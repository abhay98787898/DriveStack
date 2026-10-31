import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { Readable } from 'stream';
import { db } from '@/lib/db';
import { downloadStreamFromDrive } from '@/lib/gdrive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseByteRange(value: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

function rangeNotSatisfiable(size: number) {
  return new NextResponse(null, {
    status: 416,
    headers: {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = await db.asset.findUnique({ where: { id } });

    if (!asset || asset.googleFileId.startsWith('pending_')) {
      return new NextResponse('Asset not found', { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const widthParam = searchParams.get('w');
    const heightParam = searchParams.get('h');
    const formatParam = searchParams.get('format')?.toLowerCase();
    const qualityParam = searchParams.get('q');
    const rawWidth = widthParam ? Number.parseInt(widthParam, 10) : undefined;
    const rawHeight = heightParam ? Number.parseInt(heightParam, 10) : undefined;
    const width = rawWidth && Number.isFinite(rawWidth) ? Math.min(4000, Math.max(1, rawWidth)) : undefined;
    const height = rawHeight && Number.isFinite(rawHeight) ? Math.min(4000, Math.max(1, rawHeight)) : undefined;
    const parsedQuality = qualityParam ? Number.parseInt(qualityParam, 10) : 80;
    const quality = Number.isFinite(parsedQuality) ? Math.min(100, Math.max(1, parsedQuality)) : 80;
    const isImage = asset.mimeType.startsWith('image/');
    const hasTransformations = Boolean(width || height || formatParam);
    const rangeHeader = request.headers.get('range');

    // Byte ranges apply to the original media representation, not transformed output.
    if (rangeHeader && hasTransformations) {
      return new NextResponse('Range requests are not supported with image transformations', { status: 400 });
    }

    let upstreamRange: string | undefined;
    let expectedRange: { start: number; end: number } | null = null;
    if (rangeHeader) {
      expectedRange = parseByteRange(rangeHeader, Number(asset.sizeBytes));
      if (!expectedRange) return rangeNotSatisfiable(Number(asset.sizeBytes));
      upstreamRange = `bytes=${expectedRange.start}-${expectedRange.end}`;
    }

    const media = await downloadStreamFromDrive(asset.accountId, asset.googleFileId, upstreamRange);
    const stream = media.stream;

    if (isImage && hasTransformations) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const inputBuffer = Buffer.concat(chunks);
      let transformer = sharp(inputBuffer);

      if (width || height) {
        transformer = transformer.resize({ width, height, fit: 'inside', withoutEnlargement: true });
      }

      let outputMimeType = asset.mimeType;
      if (formatParam === 'webp') {
        transformer = transformer.webp({ quality });
        outputMimeType = 'image/webp';
      } else if (formatParam === 'jpeg' || formatParam === 'jpg') {
        transformer = transformer.jpeg({ quality });
        outputMimeType = 'image/jpeg';
      } else if (formatParam === 'png') {
        transformer = transformer.png({ quality });
        outputMimeType = 'image/png';
      } else if (formatParam === 'avif') {
        transformer = transformer.avif({ quality });
        outputMimeType = 'image/avif';
      }

      const outputBuffer = await transformer.toBuffer();
      return new NextResponse(new Uint8Array(outputBuffer), {
        status: 200,
        headers: {
          'Content-Type': outputMimeType,
          'Content-Length': outputBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    };

    let status = 200;
    if (expectedRange && media.status === 206) {
      status = 206;
      headers['Content-Range'] = media.contentRange ||
        `bytes ${expectedRange.start}-${expectedRange.end}/${asset.sizeBytes}`;
      headers['Content-Length'] = media.contentLength ||
        String(expectedRange.end - expectedRange.start + 1);
    } else if (asset.sizeBytes) {
      headers['Content-Length'] = asset.sizeBytes.toString();
    }

    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new NextResponse(webStream, { status, headers });
  } catch (error: unknown) {
    return new NextResponse(error instanceof Error ? error.message : 'Error delivering media', { status: 500 });
  }
}

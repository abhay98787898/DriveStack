import sharp, { type Metadata } from 'sharp';

export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;

export class ImageUploadError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  tiff: 'image/tiff',
};

export function sanitizeImageName(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || 'image';
  const safe = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return safe || 'image';
}

export async function inspectImageUpload(buffer: Buffer, declaredMimeType: string) {
  if (buffer.length === 0) throw new ImageUploadError('Image file is empty', 400);
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageUploadError(`Image exceeds the ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB upload limit`, 413);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: 100_000_000, failOn: 'error' }).metadata();
  } catch {
    throw new ImageUploadError('Uploaded file is not a valid or supported image', 415);
  }

  const actualMimeType = metadata.format ? MIME_BY_FORMAT[metadata.format] : undefined;
  if (!actualMimeType || actualMimeType !== declaredMimeType.toLowerCase()) {
    throw new ImageUploadError('Image content does not match the declared MIME type', 415);
  }

  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000) {
    throw new ImageUploadError('Image dimensions are invalid or exceed the 100-megapixel limit', 413);
  }

  return { width: metadata.width, height: metadata.height, mimeType: actualMimeType };
}

export function isAllowedImageMimeType(value: unknown): value is string {
  return typeof value === 'string' && Object.values(MIME_BY_FORMAT).includes(value.toLowerCase());
}

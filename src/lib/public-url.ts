const FALLBACK_APP_URL = 'http://localhost:3000';

export function getPublicAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const value = configured || FALLBACK_APP_URL;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('NEXT_PUBLIC_APP_URL must use http or https');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('NEXT_PUBLIC_APP_URL must be an origin or base URL without credentials, query, or hash');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Invalid NEXT_PUBLIC_APP_URL configuration');
  }
}

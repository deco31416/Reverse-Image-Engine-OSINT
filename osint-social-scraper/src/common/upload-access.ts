import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const developmentSecret = randomBytes(32).toString('hex');

function signingSecret() {
  const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET ||
    process.env.SOCIAL_SCRAPER_API_KEY || process.env.MICROSERVICES_API_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('Upload signing secret is required');
  return developmentSecret;
}

export function signUploadUrl(value: string, baseUrl = process.env.UPLOAD_PUBLIC_BASE_URL || '') {
  let url: URL;
  try { url = new URL(value, 'http://uploads.invalid'); } catch { return value; }
  if (!url.pathname.startsWith('/uploads/')) return value;
  if (/^https?:\/\//i.test(value)) {
    if (!baseUrl || url.origin !== new URL(baseUrl).origin) return value;
  }
  const ttl = Math.min(Math.max(Number(process.env.UPLOAD_URL_TTL_SECONDS) || 86400, 60), 86400);
  const expires = String(Math.floor(Date.now() / 1000) + ttl);
  const signature = createHmac('sha256', signingSecret()).update(url.pathname + '|' + expires).digest('hex');
  url.searchParams.set('expires', expires);
  url.searchParams.set('signature', signature);
  return /^https?:\/\//i.test(value) ? url.toString() : url.pathname + url.search;
}

export function verifyUploadUrl(value: string) {
  try {
    const url = new URL(value, 'http://uploads.invalid');
    const expires = url.searchParams.get('expires') || '';
    const signature = url.searchParams.get('signature') || '';
    if (!url.pathname.startsWith('/uploads/') || !/^\d{10,12}$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Number(expires) <= now || Number(expires) > now + 86400) return false;
    const expected = createHmac('sha256', signingSecret()).update(url.pathname + '|' + expires).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

export function uploadAccessMiddleware(req: Request, res: Response, next: NextFunction) {
  const pathname = new URL(req.originalUrl, 'http://uploads.invalid').pathname;
  if (!['GET', 'HEAD'].includes(req.method) || !/\.(?:png|jpe?g|webp|gif)$/i.test(pathname) || !verifyUploadUrl(req.originalUrl)) {
    res.status(403).json({ message: 'A valid temporary image URL is required' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}


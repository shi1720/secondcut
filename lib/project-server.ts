import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { PROJECT_LIMITS, photoPathSchema } from './project-schema';

export function result(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function identity() { return (await getChatGPTUser())?.userId ?? null; }
export function validWrite(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  return origin === null || origin === new URL(request.url).origin;
}
export class PayloadLimitError extends Error { constructor() { super('Request too large'); } }
export async function boundedBytes(request: Request, limit: number) {
  const claimed = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(claimed) || claimed > limit) throw new PayloadLimitError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PayloadLimitError(); }
      parts.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export async function projectBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new Error('Send application/json');
  const bytes = await boundedBytes(request, PROJECT_LIMITS.jsonBytes);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function ownerPrefix(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner));
  return `${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}_`;
}
export async function photoKeyAllowed(key: string, owner: string) {
  const prefix = await ownerPrefix(owner);
  return key.startsWith(prefix) && uuid(key.slice(prefix.length));
}
export async function sourceAvailable(image: string, owner: string) {
  if (!photoPathSchema.safeParse(image).success) return false;
  if (image.startsWith('/demo/')) return true;
  const key = image.slice('/api/photos/'.length);
  return await photoKeyAllowed(key, owner) && !!env.BUCKET && !!await env.BUCKET.head(key);
}
export async function storedUsage(owner: string) {
  if (!env.BUCKET) throw new Error('Storage unavailable');
  const prefix = await ownerPrefix(owner);
  let cursor: string | undefined, count = 0, size = 0;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) { count += 1; size += object.size; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { count, size };
}
export async function erasePhotos(owner: string) {
  if (!env.BUCKET) throw new Error('Storage unavailable');
  const prefix = await ownerPrefix(owner);
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await env.BUCKET.delete(page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

import { env } from 'cloudflare:workers';
import { PROJECT_LIMITS } from '../../../lib/project-schema';
import { boundedBytes, identity, ownerPrefix, PayloadLimitError, result, storedUsage, validWrite } from '../../../lib/project-server';

export async function POST(request: Request) {
  if (!validWrite(request)) return result({ error: 'Invalid request origin.' }, 403);
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to store a source photograph.' }, 401);
  if (!env.BUCKET) return result({ error: 'Photograph storage is unavailable.' }, 503);
  try {
    const bytes = await boundedBytes(request, PROJECT_LIMITS.photoBytes);
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    if (!isJpeg && !isPng) return result({ error: 'Upload a JPEG or PNG photograph.' }, 415);
    const usage = await storedUsage(owner);
    if (usage.count >= PROJECT_LIMITS.photos || usage.size + bytes.byteLength > PROJECT_LIMITS.storedPhotoBytes) return result({ error: 'Workspace photo limit reached: 100 photographs or 50 MB. Delete old projects or erase the workspace to make room.' }, 409);
    const key = `${await ownerPrefix(owner)}${crypto.randomUUID()}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: isJpeg ? 'image/jpeg' : 'image/png' } });
    return result({ url: `/api/photos/${key}` }, 201);
  } catch (error) { return result({ error: error instanceof PayloadLimitError ? 'Photograph must be smaller than 5 MB.' : 'Photograph could not be stored. Please retry.' }, error instanceof PayloadLimitError ? 413 : 503); }
}

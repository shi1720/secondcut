import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../../db';
import { projects } from '../../../../db/schema';
import { projectSchema } from '../../../../lib/project-schema';
import { identity, photoKeyAllowed, result, validWrite } from '../../../../lib/project-server';
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to view this photograph.' }, 401);
  const { id } = await context.params;
  if (!await photoKeyAllowed(id, owner)) return result({ error: 'Photograph not found.' }, 404);
  try {
    if (!env.BUCKET) return result({ error: 'Photograph storage is unavailable.' }, 503);
    const photo = await env.BUCKET.get(id);
    if (!photo) return result({ error: 'Photograph not found.' }, 404);
    return new Response(photo.body, { headers: { 'Content-Type': photo.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return result({ error: 'Photograph could not be loaded. Please retry.' }, 503); }
}
export async function DELETE(request: Request, context: RouteContext) {
  if (!validWrite(request)) return result({ error: 'Invalid request origin.' }, 403);
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to delete this photograph.' }, 401);
  const { id } = await context.params;
  if (!await photoKeyAllowed(id, owner)) return result({ error: 'Photograph not found.' }, 404);
  try {
    if (!env.BUCKET) return result({ error: 'Photograph storage is unavailable.' }, 503);
    const rows = await getDb().select({ payload: projects.payload }).from(projects).where(eq(projects.owner, owner));
    if (rows.some(row => projectSchema.parse(JSON.parse(row.payload)).image === `/api/photos/${id}`)) return result({ error: 'Delete the saved projects using this photograph first.' }, 409);
    await env.BUCKET.delete(id);
    return result({ ok: true });
  } catch { return result({ error: 'Photograph could not be deleted. Please retry.' }, 503); }
}

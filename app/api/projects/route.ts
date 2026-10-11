import { env } from 'cloudflare:workers';
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { projects } from '../../../db/schema';
import { PROJECT_LIMITS, projectSchema } from '../../../lib/project-schema';
import { erasePhotos, identity, PayloadLimitError, photoKeyAllowed, projectBody, result, sourceAvailable, uuid, validWrite } from '../../../lib/project-server';

export async function GET() {
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to open your saved projects.' }, 401);
  try {
    const rows = await getDb().select().from(projects).where(eq(projects.owner, owner)).orderBy(desc(projects.createdAt)).limit(PROJECT_LIMITS.projects);
    return result({ projects: rows.map(row => ({ ...projectSchema.parse(JSON.parse(row.payload)), id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt })) });
  } catch { return result({ error: 'Saved projects are unavailable. Please retry.' }, 503); }
}
export async function POST(request: Request) {
  if (!validWrite(request)) return result({ error: 'Invalid request origin.' }, 403);
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to save this project.' }, 401);
  let document;
  try {
    const parsed = projectSchema.safeParse(await projectBody(request));
    if (!parsed.success) return result({ error: parsed.error.issues[0].message }, 400);
    document = parsed.data;
  } catch (error) { return result({ error: error instanceof PayloadLimitError ? 'Project exceeds the 100 KB save limit. Use a smaller mask.' : 'Invalid project data. Send a valid JSON project.' }, error instanceof PayloadLimitError ? 413 : 400); }
  try {
    if (!await sourceAvailable(document.image, owner)) return result({ error: 'Source photograph not found in your workspace.' }, 403);
    const db = getDb();
    const [usage] = await db.select({ total: count() }).from(projects).where(eq(projects.owner, owner));
    if (usage.total >= PROJECT_LIMITS.projects) return result({ error: 'Your workspace holds 50 projects. Export and delete an older project before saving another.' }, 409);
    const id = crypto.randomUUID(), createdAt = Date.now(), updatedAt = createdAt;
    await db.insert(projects).values({ id, owner, name: document.name, payload: JSON.stringify(document), createdAt, updatedAt });
    return result({ project: { ...document, id, createdAt, updatedAt } }, 201);
  } catch { return result({ error: 'Project could not be saved. Please retry.' }, 503); }
}
export async function DELETE(request: Request) {
  if (!validWrite(request)) return result({ error: 'Invalid request origin.' }, 403);
  const owner = await identity();
  if (!owner) return result({ error: 'Sign in to remove your projects.' }, 401);
  const id = new URL(request.url).searchParams.get('id');
  if (id !== null && !uuid(id)) return result({ error: 'Provide a valid project identifier.' }, 400);
  try {
    const db = getDb();
    if (id === null) {
      await db.delete(projects).where(eq(projects.owner, owner));
      await erasePhotos(owner);
    } else {
      const condition = and(eq(projects.owner, owner), eq(projects.id, id));
      const [row] = await db.select().from(projects).where(condition).limit(1);
      await db.delete(projects).where(condition);
      if (row) {
        const image = projectSchema.parse(JSON.parse(row.payload)).image;
        if (image.startsWith('/api/photos/')) {
          const remaining = await db.select({ payload: projects.payload }).from(projects).where(eq(projects.owner, owner));
          const used = remaining.some(other => projectSchema.parse(JSON.parse(other.payload)).image === image);
          const key = image.slice('/api/photos/'.length);
          if (!used && await photoKeyAllowed(key, owner)) {
            if (!env.BUCKET) throw new Error('Storage unavailable');
            await env.BUCKET.delete(key);
          }
        }
      }
    }
    return result({ ok: true });
  } catch { return result({ error: 'Deletion could not finish. Retry, or erase the workspace to remove remaining photographs.' }, 503); }
}

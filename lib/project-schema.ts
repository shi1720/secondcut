import { z } from 'zod';

export const PROJECT_LIMITS = { projects: 50, photos: 100, photoBytes: 5 * 1024 * 1024, storedPhotoBytes: 50 * 1024 * 1024, jsonBytes: 100_000 } as const;
const finite = () => z.number().finite();
const componentId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved pattern identifier');
export const photoPathSchema = z.string().max(180).refine(value =>
  value === '/demo/leather.png' || value === '/demo/fabric.png' ||
  /^\/api\/photos\/[a-f0-9]{64}_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), 'Use a photograph uploaded to this workspace');
export const patternSchema = z.object({
  id: componentId, name: z.string().trim().min(1).max(80),
  widthMm: finite().min(5).max(3000), heightMm: finite().min(5).max(3000),
  quantity: finite().int().min(1).max(30), value: finite().min(0).max(1_000_000),
  shape: z.enum(['rectangle', 'ellipse']), rotate: z.boolean(),
});
export const maskSchema = z.object({
  width: finite().int().min(16).max(1024), height: finite().int().min(16).max(1024),
  // Row-major alternating background/foreground runs. A leading zero is allowed.
  runs: z.array(finite().int().min(0).max(1024 * 1024)).min(2).max(25_000),
}).superRefine((mask, context) => {
  if (mask.runs.reduce((sum, run) => sum + run, 0) !== mask.width * mask.height || mask.runs.slice(1).some(run => run === 0)) {
    context.addIssue({ code: 'custom', message: 'Mask run lengths must cover the image exactly without empty intermediate runs' });
  }
  if (mask.runs.reduce((sum, run, index) => sum + (index % 2 ? run : 0), 0) === 0) context.addIssue({ code: 'custom', message: 'Mask must contain usable material' });
});
export const projectSchema = z.object({
  name: z.string().trim().min(1).max(100), image: photoPathSchema,
  widthMm: finite().min(50).max(3000), clearanceMm: finite().min(0).max(30), gapMm: finite().min(0).max(30),
  mask: maskSchema,
  exclusions: z.array(z.object({ x: finite().min(0).max(1), y: finite().min(0).max(1), r: finite().min(.001).max(1) })).max(100),
  patterns: z.array(patternSchema).min(1).max(12),
  reviewed: z.boolean(), model: z.string().trim().min(1).max(200),
  points: z.array(z.object({ x: finite().min(0).max(1), y: finite().min(0).max(1), label: z.union([z.literal(0), z.literal(1)]) })).max(64),
  currency: z.enum(['INR', 'USD']).default('INR'),
}).superRefine((project, context) => {
  if (new Set(project.patterns.map(pattern => pattern.id)).size !== project.patterns.length) context.addIssue({ code: 'custom', message: 'Pattern identifiers must be unique' });
  if (project.patterns.reduce((sum, pattern) => sum + pattern.quantity, 0) > 100) context.addIssue({ code: 'custom', message: 'Use at most 100 requested pieces per plan' });
});
export type ProjectDocument = z.infer<typeof projectSchema>;
export type ProjectRecord = ProjectDocument & { id: string; createdAt: number; updatedAt: number };

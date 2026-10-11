/** Binary masks are geometric working data, not safe cutting instructions. */
export type Mask = { width: number; height: number; data: Uint8Array };
export type PromptPoint = { x: number; y: number; label: 0 | 1 };

export function validateMask(mask: Mask): void {
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1 || mask.width > 2048 || mask.height > 2048 || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) throw new Error('Invalid mask dimensions.');
}
export function maskArea(mask: Mask): number {
  validateMask(mask);
  let count = 0; for (const value of mask.data) if (value) count++;
  return count;
}
export function fitDimensions(width: number, height: number, maxEdge = 512) {
  if (![width, height, maxEdge].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid image dimensions.');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function resizeMaskNearest(mask: Mask, width: number, height: number): Mask {
  validateMask(mask);
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 2048)) throw new Error('Invalid resized mask dimensions.');
  const output: Mask = { width, height, data: new Uint8Array(width * height) }; validateMask(output);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / width));
    const sy = Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / height));
    output.data[y * width + x] = mask.data[sy * mask.width + sx] ? 1 : 0;
  }
  return output;
}
function validatePoints(points: PromptPoint[], requireForeground = true) {
  if (points.length > 32 || (requireForeground && !points.some(p => p.label === 1)) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || (p.label !== 0 && p.label !== 1))) throw new Error('Use valid normalized prompts including a foreground point.');
}
function pointIndex(mask: Mask, p: PromptPoint) {
  return Math.min(mask.height - 1, Math.floor(p.y * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(p.x * mask.width));
}
/** Keep the largest four-connected component hit by a foreground prompt.
 * Unprompted islands are removed; holes remain holes, never silently filled. */
export function largestPromptComponent(mask: Mask, points: PromptPoint[]): Mask {
  validateMask(mask); validatePoints(points);
  const labels = new Int32Array(mask.data.length);
  const queue = new Int32Array(mask.data.length);
  const sizes = [0]; let component = 0;
  for (let start = 0; start < mask.data.length; start++) {
    if (!mask.data[start] || labels[start]) continue;
    component++; let head = 0, tail = 1; queue[0] = start; labels[start] = component;
    while (head < tail) {
      const i = queue[head++], x = i % mask.width;
      const visit = (next: number) => { if (next >= 0 && next < mask.data.length && mask.data[next] && !labels[next]) { labels[next] = component; queue[tail++] = next; } };
      if (x > 0) visit(i - 1); if (x < mask.width - 1) visit(i + 1);
      visit(i - mask.width); visit(i + mask.width);
    }
    sizes[component] = tail;
  }
  let selected = 0;
  for (const p of points) if (p.label === 1) {
    const candidate = labels[pointIndex(mask, p)];
    if (candidate && sizes[candidate] > sizes[selected]) selected = candidate;
  }
  if (!selected) throw new Error('No material mask covers a foreground point. Click well inside the remnant and retry.');
  return { width: mask.width, height: mask.height, data: Uint8Array.from(labels, label => label === selected ? 1 : 0) };
}
/** Immutable brush operation. x/y normalized; radius is in mask pixels. */
export function paintDisk(mask: Mask, x: number, y: number, radius: number, value: 0 | 1): Mask {
  validateMask(mask);
  if (![x, y, radius].every(Number.isFinite) || (value !== 0 && value !== 1) || radius < 0 || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Invalid brush location.');
  const data = new Uint8Array(mask.data), cx = x * (mask.width - 1), cy = y * (mask.height - 1);
  for (let py = Math.max(0, Math.floor(cy - radius)); py <= Math.min(mask.height - 1, Math.ceil(cy + radius)); py++) for (let px = Math.max(0, Math.floor(cx - radius)); px <= Math.min(mask.width - 1, Math.ceil(cx + radius)); px++) if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) data[py * mask.width + px] = value;
  return { ...mask, data };
}
export function subtractMask(material: Mask, exclusion: Mask): Mask {
  validateMask(material); validateMask(exclusion);
  if (material.width !== exclusion.width || material.height !== exclusion.height) throw new Error('Exclusion mask dimensions must match.');
  return { ...material, data: Uint8Array.from(material.data, (value, i) => value && !exclusion.data[i] ? 1 : 0) };
}
export function assessMask(mask: Mask, points: PromptPoint[]): string[] {
  validatePoints(points, false);
  const area = maskArea(mask), fraction = area / mask.data.length, warnings: string[] = [];
  if (fraction < 0.002) warnings.push('The selected material is too small. Capture closer or add a foreground point.');
  if (fraction > 0.9) warnings.push('The mask covers nearly the entire image. Include the worktop and add background points.');
  for (const p of points) {
    const included = !!mask.data[pointIndex(mask, p)];
    if (p.label === 1 && !included) warnings.push('A foreground point lies outside the selected connected remnant. Select one remnant at a time.');
    if (p.label === 0 && included) warnings.push('A background point is included in the material mask. Add clearer boundary prompts.');
  }
  return [...new Set(warnings)];
}
/** Model output is [batch=1,promptBatch=1,candidate,height,width]. */
export function selectBestMask(data: ArrayLike<number>, dims: readonly number[], scores: ArrayLike<number>): { mask: Mask; score: number; candidate: number } {
  if (dims.some(n => !Number.isSafeInteger(n) || n < 1) || dims[2] > 2048 || dims[3] > 2048 || dims.length !== 4 || dims[0] !== 1 || dims[1] !== scores.length || !scores.length) throw new Error('Unexpected segmentation tensor dimensions.');
  const [, candidates, height, width] = dims;
  if (candidates > 32 || data.length !== candidates * height * width) throw new Error('Segmentation tensor size is inconsistent.');
  for (let i = 0; i < data.length; i++) if (data[i] !== 0 && data[i] !== 1) throw new Error('Segmentation masks must contain binary values.');
  let candidate = 0;
  for (let i = 0; i < scores.length; i++) { if (!Number.isFinite(scores[i])) throw new Error('The model produced an invalid score.'); if (scores[i] > scores[candidate]) candidate = i; }
  const offset = candidate * height * width;
  return { mask: { width, height, data: Uint8Array.from({ length: width * height }, (_, i) => data[offset + i] ? 1 : 0) }, score: Math.max(0, Math.min(1, scores[candidate])), candidate };
}

/** Rank only masks consistent with the user's prompts and capture constraints.
 * A high predicted-IoU score never overrides an explicitly excluded background.
 * If every candidate fails, report the failure instead of inventing a boundary. */
export function selectPromptConsistentMask(data: ArrayLike<number>, dims: readonly number[], scores: ArrayLike<number>, points: PromptPoint[]): { mask: Mask; score: number; candidate: number } {
  validatePoints(points);
  selectBestMask(data, dims, scores); // validates complete tensor and scores
  const width = dims[3], height = dims[2], pixels = width * height;
  const ranked = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const failures: string[] = [];
  for (const candidate of ranked) {
    const raw: Mask = { width, height, data: Uint8Array.from({ length: pixels }, (_, i) => data[candidate * pixels + i] ? 1 : 0) };
    try {
      const mask = largestPromptComponent(raw, points);
      const warnings = assessMask(mask, points);
      if (scores[candidate] < 0.45) warnings.push('The model is uncertain about this boundary. Add clearer foreground/background points.');
      if (warnings.length) { failures.push(...warnings); continue; }
      return { mask, score: Math.max(0, Math.min(1, scores[candidate])), candidate };
    } catch (error) { failures.push(error instanceof Error ? error.message : 'No prompted material component.'); }
  }
  throw new Error(`No model candidate passed the boundary checks. ${[...new Set(failures)].join(' ')}`);
}

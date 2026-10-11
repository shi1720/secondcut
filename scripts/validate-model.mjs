/** Actual local model smoke test. Run: npx tsx scripts/validate-model.mjs
 * Optional --output FILE and --mask-dir DIR emit evidence, never app inputs.
 * Uses synthetic photographs; this is not a field-accuracy benchmark. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SamModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';
import { fitDimensions, selectPromptConsistentMask, assessMask, maskArea } from '../lib/mask.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
function argument(name) { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; }
const output = argument('--output'), maskDir = argument('--mask-dir');
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = path.join(root, 'public/models/');
const started = performance.now();
const [model, processor] = await Promise.all([
  SamModel.from_pretrained('slimsam', { dtype: 'q8', device: 'cpu', local_files_only: true }),
  AutoProcessor.from_pretrained('slimsam', { local_files_only: true }),
]);
const cases = [], modelLoadMs = Math.round(performance.now() - started);
try {
  for (const name of ['leather', 'fabric']) {
    const t0 = performance.now();
    let image = await RawImage.read(path.join(root, `public/demo/${name}.png`));
    const fit = fitDimensions(image.width, image.height, 1024);
    if (image.width !== fit.width || image.height !== fit.height) image = await image.resize(fit.width, fit.height);
    const processed = await processor(image);
    let embeddings;
    try { embeddings = await model.get_image_embeddings({ pixel_values: processed.pixel_values }); }
    finally { processed.pixel_values.dispose(); }
    const encoded = performance.now();
    const runs = [];
    try {
      // Two different prompt sets intentionally reuse the same encoder output.
      for (const [run, foreground] of [[0, [0.5, 0.5]], [1, [0.4, 0.4]]]) {
        const points = [{ x: foreground[0], y: foreground[1], label: 1 }, { x: 0.02, y: 0.02, label: 0 }];
        const input_points = processor.reshape_input_points([points.map(p => [p.x * (image.width - 1), p.y * (image.height - 1)])], processed.original_sizes, processed.reshaped_input_sizes);
        const input_labels = new Tensor('int64', BigInt64Array.from(points.map(p => BigInt(p.label))), [1, 1, points.length]);
        let result, masks = [];
        const decoderStart = performance.now();
        try {
          result = await model({ ...embeddings, input_points, input_labels });
          const working = fitDimensions(image.width, image.height, 512);
          masks = await processor.post_process_masks(result.pred_masks, [[working.height, working.width]], processed.reshaped_input_sizes);
          const chosen = selectPromptConsistentMask(masks[0].data, masks[0].dims, result.iou_scores.data, points);
          const warnings = assessMask(chosen.mask, points), pixels = maskArea(chosen.mask);
          assert.deepEqual(warnings, []); assert.ok(pixels > 0 && pixels < chosen.mask.data.length);
          assert.ok(chosen.mask.width <= 512 && chosen.mask.height <= 512);
          assert.ok(chosen.mask.data.every(v => v === 0 || v === 1));
          runs.push({ run, embeddingReused: run > 0, points, scoreDims: result.iou_scores.dims, maskDims: masks[0].dims, rawPredictedIoUs: [...result.iou_scores.data], selectedCandidate: chosen.candidate, returnedScore: chosen.score, maskPixels: pixels, areaFraction: pixels / chosen.mask.data.length, warnings, decoderAndPostprocessMs: Math.round(performance.now() - decoderStart) });
          if (maskDir) {
            await fs.mkdir(maskDir, { recursive: true });
            await fs.writeFile(path.join(maskDir, `${name}-${run}.pgm`), Buffer.concat([Buffer.from(`P5\n${chosen.mask.width} ${chosen.mask.height}\n255\n`), Buffer.from(chosen.mask.data.map(v => v * 255))]));
          }
        } finally {
          input_points.dispose(); input_labels.dispose(); result?.pred_masks.dispose(); result?.iou_scores.dispose(); for (const mask of masks) mask.dispose();
        }
      }
    } finally { for (const tensor of Object.values(embeddings)) tensor.dispose(); }
    cases.push({ fixture: `${name}.png`, image: { width: image.width, height: image.height }, imageEncodeAndPreprocessMs: Math.round(encoded - t0), runs });
  }
  const report = { generatedAt: new Date().toISOString(), model: 'Xenova/slimsam-77-uniform', revision: '5850ab45f587c112167512ffef949107115e26a0', dtype: 'q8', provider: 'Node native CPU; browser WASM requires separate smoke test', modelLoadMs, totalMs: Math.round(performance.now() - started), cases, limitations: 'Synthetic photographs, no precomputed masks. Passing is evidence of actual inference and prompt checks, not measured field accuracy, physical dimensions or cutting safety.' };
  if (output) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
} finally { await model.dispose(); }

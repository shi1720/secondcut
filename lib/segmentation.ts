import { fitDimensions, selectPromptConsistentMask, type Mask, type PromptPoint } from './mask';
export type { Mask, PromptPoint } from './mask';
type Transformers = typeof import('@huggingface/transformers');
type SamModel = InstanceType<Transformers['SamModel']>;
type Processor = InstanceType<Transformers['SamProcessor']>;
type Tensor = InstanceType<Transformers['Tensor']>;
type Embeddings = { image_embeddings: Tensor; image_positional_embeddings: Tensor };
type CachedImage = { url: string; width: number; height: number; originalSizes: [number, number][]; reshapedSizes: [number, number][]; embeddings: Embeddings };
let runtime: Promise<{ lib: Transformers; model: SamModel; processor: Processor }> | undefined;
let cached: CachedImage | undefined;
let pending: Promise<unknown> = Promise.resolve();
const MODEL = 'SlimSAM 77-uniform · quantized ONNX · user-prompted segmentation';

function disposeEmbeddings() {
  if (!cached) return;
  cached.embeddings.image_embeddings.dispose(); cached.embeddings.image_positional_embeddings.dispose(); cached = undefined;
}
async function getRuntime(progress: (s: string) => void) {
  if (!runtime) runtime = (async () => {
    // Load the official runtime as an untransformed public ES module. Its
    // proxy worker imports this same module; bundler-injected DOM/HMR code
    // would crash in a worker. Transformers explicitly supports this runtime
    // injection hook, which must be registered before importing the library.
    const ortUrl = new URL('/models/ort/ort.webgpu.bundle.min.mjs', window.location.origin).href;
    const ort = await import(/* @vite-ignore */ ortUrl);
    const runtimeKey = Symbol.for('onnxruntime');
    const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
    globals[runtimeKey] = ort;
    const lib = await import('@huggingface/transformers');
    lib.env.allowRemoteModels = false; lib.env.allowLocalModels = true; lib.env.localModelPath = '/models/';
    if (lib.env.backends.onnx.wasm) {
      lib.env.backends.onnx.wasm.numThreads = 1;
      // ORT dynamically imports its helper module. An absolute origin URL
      // keeps Vite from adding ?import to this public asset during development.
      // Same-origin URLs also work unchanged in the published static build.
      lib.env.backends.onnx.wasm.wasmPaths = new URL('/models/ort/', window.location.origin).href;
      lib.env.backends.onnx.wasm.proxy = true;
    }
    const progress_callback = (event: { status: string; file?: string; progress?: number }) => {
      if (event.status === 'progress') progress(`Loading local image model${event.progress === undefined ? '' : ` · ${Math.round(event.progress)}%`}…`);
    };
    const [model, processor] = await Promise.all([
      lib.SamModel.from_pretrained('slimsam', { dtype: 'q8', device: 'auto', session_options: { executionProviders: ['wasm'] }, local_files_only: true, progress_callback }),
      lib.AutoProcessor.from_pretrained('slimsam', { local_files_only: true }),
    ]);
    return { lib, model: model as SamModel, processor: processor as Processor };
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}

/** Real local SlimSAM inference. No color-threshold fallback or fixture mask.
 * Repeated prompts reuse one image embedding; changing URL clears the old one.
 * Jobs are serialized so a new photo cannot dispose an in-flight embedding. */
export function segmentMaterial(imageUrl: string, points: PromptPoint[], onProgress: (s: string) => void): Promise<{ mask: Mask; score: number; model: string; durationMs: number }> {
  const snapshot = points.map(p => ({ ...p }));
  const job = pending.then(() => segment(imageUrl, snapshot, onProgress));
  pending = job.then(() => undefined, () => undefined);
  return job;
}
async function segment(imageUrl: string, points: PromptPoint[], progress: (s: string) => void) {
  if (typeof document === 'undefined') throw new Error('Material segmentation runs in your browser.');
  if (!imageUrl || points.length < 1 || points.length > 32 || !points.some(p => p.label === 1) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || (p.label !== 0 && p.label !== 1))) throw new Error('Add 1–32 valid points, including a foreground point inside the material.');
  const started = performance.now();
  progress('Loading the on-device segmentation model…');
  const { lib, model, processor } = await getRuntime(progress);
  if (!cached || cached.url !== imageUrl) {
    disposeEmbeddings();
    progress('Reading the material photograph…');
    let image = await lib.RawImage.read(imageUrl);
    if (Math.min(image.width, image.height) < 128) throw new Error('Use a sharper photo at least128 pixels on each side.');
    const fit = fitDimensions(image.width, image.height, 1024);
    if (image.width !== fit.width || image.height !== fit.height) image = await image.resize(fit.width, fit.height);
    const inputs = await processor(image);
    progress('Encoding the remnant image · reused for your next prompts…');
    // Give the browser a chance to paint progress before CPU work.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      const embeddings = await model.get_image_embeddings({ pixel_values: inputs.pixel_values });
      cached = { url: imageUrl, width: image.width, height: image.height, originalSizes: inputs.original_sizes, reshapedSizes: inputs.reshaped_input_sizes, embeddings };
    } finally { inputs.pixel_values.dispose(); }
  } else progress('Reusing the image embedding · refining your prompts…');
  const source = cached;
  const inputPoints = processor.reshape_input_points([points.map(p => [p.x * (source.width - 1), p.y * (source.height - 1)])], source.originalSizes, source.reshapedSizes);
  const inputLabels = new lib.Tensor('int64', BigInt64Array.from(points.map(p => BigInt(p.label))), [1, 1, points.length]);
  progress('Separating material from the worktop…');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  let outputs: { pred_masks: Tensor; iou_scores: Tensor } | undefined;
  let masks: Tensor[] = [];
  try {
    const result = await model({ ...source.embeddings, input_points: inputPoints, input_labels: inputLabels }) as { pred_masks: Tensor; iou_scores: Tensor };
    outputs = result;
    const fit = fitDimensions(source.width, source.height, 512);
    // Postprocess directly to working resolution: remove model padding, then
    // resize logits and binarize. Never build an unnecessarily huge full mask.
    masks = await processor.post_process_masks(result.pred_masks, [[fit.height, fit.width]], source.reshapedSizes);
    if (masks.length !== 1 || result.iou_scores.dims.join(',') !== `1,1,${masks[0].dims[1]}`) throw new Error('Unexpected segmentation model output.');
    const selected = selectPromptConsistentMask(masks[0].data as Uint8Array, masks[0].dims, result.iou_scores.data as Float32Array, points);
    const mask = selected.mask;
    progress('Material boundary ready · inspect and correct it before planning.');
    return { mask, score: selected.score, model: MODEL, durationMs: Math.round(performance.now() - started) };
  } finally {
    inputPoints.dispose(); inputLabels.dispose();
    outputs?.pred_masks.dispose(); outputs?.iou_scores.dispose();
    for (const mask of masks) mask.dispose();
  }
}

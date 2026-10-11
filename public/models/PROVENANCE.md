# SecondCut local segmentation model

Model: **Xenova/slimsam-77-uniform**, quantized ONNX conversion of **nielsr/slimsam-77-uniform** (SlimSAM, pruned Segment Anything). Downloaded11October2026 from Hugging Face revision `5850ab45f587c112167512ffef949107115e26a0`. The original model card is retained in `slimsam/README.md`.

- Publisher/model card: https://huggingface.co/Xenova/slimsam-77-uniform
- Base model: https://huggingface.co/nielsr/slimsam-77-uniform
- SlimSAM research/code: https://github.com/czg1225/SlimSAM
- Transformers.js: https://github.com/huggingface/transformers.js
- ONNX Runtime: https://github.com/microsoft/onnxruntime

The model card declares Apache-2.0. The model is pretrained; SecondCut did not train it. Quantization and pruning trade accuracy for browser efficiency. Its training-data provenance is inherited from upstream SAM/SlimSAM; no training photographs are included. Model weights/config are unmodified and self-hosted so inference requires no third-party image upload or API key. This does not guarantee offline operation before application assets are cached.

`SHA256.json` records model revision, runtime version, file lengths and actual SHA-256 hashes. The two ONNX model hashes are verified against the upstream repository's LFS SHA-256 metadata by `scripts/download-model.mjs`. Run that script after installing dependencies to regenerate matching model/runtime assets. Weights total13,785,975bytes; WebAssembly runtime adds roughly21MiB plus a helper module. Files are served from the application origin. The official, untransformed `ort.webgpu.bundle.min.mjs` is registered through Transformers.js’s ONNX runtime injection hook before importing Transformers. Despite the bundle filename, session options explicitly select only the WASM execution provider. This lets the proxy worker import its own runtime without development-server DOM or hot-reload code. The model, runtime bundle and WASM helpers must stay at the recorded matching versions. Runtime is single-threaded WASM in an ONNX proxy worker, keeping inference off the interface thread without requiring cross-origin isolation; memory use is larger than download size, and older phones may be slow or run out of memory. Use a modern desktop browser for complex work.

The included ONNX Runtime MIT license is at `ort/LICENSE.txt`. SlimSAM/SAM and Transformers.js use Apache-2.0; see `APACHE-2.0.txt`. The model card license declaration is the provenance record, not a new license grant by SecondCut.

## What inference actually does

Positive/negative normalized clicks are transformed to SAM's padded image coordinates. The image encoder embedding is computed once and reused for later prompts on the same image URL. The mask decoder returns three candidates. SecondCut removes padding, resamples logits to a maximum512-pixel working grid, and binarizes at SAM's zero-logit threshold. For each candidate it retains the largest four-connected material island containing a positive click, preserving holes. Candidates contradicting foreground/background prompts, covering below0.2% or above90% of the photo, or with predictedIoU below0.45 are rejected. The highest **predicted IoU** among remaining valid candidates is returned. All-invalid outputs visibly fail instead of producing substitute geometry. This matters because the highest-scoring candidate may represent the entire scene rather than the remnant. There is no color-threshold fallback and no hardcoded sample mask.

Predicted IoU is the model's estimate of mask quality, **not measured accuracy, a probability, physical dimensional accuracy or evidence that every defect was found**. It does not validate leather condition, thickness, grain, stretch, cutting suitability or manufacturing safety. Users must inspect/correct the boundary and mark unusable areas. A dark mark may remain inside the material mask: excluding defects is an explicit user task.

The photograph must be taken from directly overhead on a neutral worktop, with the full remnant visible and without overlapping objects. Pixel-level boundaries depend on lighting, shadows, texture, perspective and prompt quality. Photo calibration and any subsequent nesting/cutting recommendations require their own validation and physical verification before cutting. Masks are working geometry, not certified instructions.

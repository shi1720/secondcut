/** Fetch pinned, hash-checked SlimSAM weights and copy the installed ORT runtime. */
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const modelDir = path.join(root, 'public/models/slimsam');
const revision = '5850ab45f587c112167512ffef949107115e26a0';
const base = `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${revision}/`;
const files = [
 ['config.json', null], ['preprocessor_config.json', null], ['README.md', null],
 ['onnx/vision_encoder_quantized.onnx', 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971'],
 ['onnx/prompt_encoder_mask_decoder_quantized.onnx', 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2'],
];
const hashes = {};
await mkdir(path.join(modelDir, 'onnx'), { recursive: true });
for (const [name, expected] of files) {
 const response = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
 if (!response.ok) throw new Error(`Download ${name}: HTTP ${response.status}`);
 const bytes = Buffer.from(await response.arrayBuffer());
 const hash = createHash('sha256').update(bytes).digest('hex');
 if (expected && hash !== expected) throw new Error(`Checksum mismatch for ${name}`);
 await writeFile(path.join(modelDir, name), bytes); hashes[name] = { sha256: hash, bytes: bytes.length };
 console.log(`${name}: ${bytes.length} bytes, SHA-256 ${hash}`);
}
const runtimeDir = path.join(root, 'public/models/ort');
await mkdir(runtimeDir, { recursive: true });
const ortDir = path.join(root, 'node_modules/onnxruntime-web');
for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort.webgpu.bundle.min.mjs']) {
 await copyFile(path.join(ortDir, 'dist', name), path.join(runtimeDir, name));
 const bytes = await readFile(path.join(runtimeDir, name));
 hashes[`ort/${name}`] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
const license = await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/89f8206ba4/LICENSE');
if (!license.ok) throw new Error('Could not retrieve the ONNX Runtime MIT license');
await writeFile(path.join(runtimeDir, 'LICENSE.txt'), await license.text());
const runtimePackage = JSON.parse(await readFile(path.join(ortDir, 'package.json'), 'utf8'));
await writeFile(path.join(root, 'public/models/SHA256.json'), JSON.stringify({ revision, model: 'Xenova/slimsam-77-uniform', runtime: runtimePackage.version, files: hashes }, null, 2));

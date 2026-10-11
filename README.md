# SecondCut

A cutting plan for the offcut you already have.

**[Open SecondCut](https://secondcut-studio.web.app)** · [Source](https://github.com/shi1720/secondcut)

SecondCut turns a photograph of an irregular leather or fabric remnant into an editable material mask and a scaled cutting layout. It helps small makers explore which rectangular or elliptical blanks fit before cutting. Created by **Shivam Gupta** for Banana Hacks 2026, with Codex coding and research assistance.

## Use it

1. Photograph one flat remnant directly overhead on a contrasting worktop, including its entire outline.
2. Add foreground and background points. Real, local SlimSAM segmentation proposes the boundary.
3. Inspect and correct the mask. Manually exclude holes, scars, weak spots and other unusable material.
4. Calibrate with two marks a known distance apart in the same plane, or enter the measured width of the **entire photograph**. This is not the remnant width.
5. Enter rectangle or ellipse dimensions, quantities, orientation, edge clearance and spacing. Generate and review the layout.
6. Export the SVG, print at 100% and measure its 50 mm scale bar. Check the physical remnant before cutting.
7. Open a guest workspace or sign in with email/password or Google to save revisions. Convert a guest workspace to a permanent account before relying on it across devices. Clearing browser authentication can make an unlinked guest workspace inaccessible.

The two labeled sample photographs are synthetic ImageGen fixtures with an assumed 300 mm photo width. They are demonstrations, not measured material or a field evaluation set.

## How it works

| Layer | Implementation |
| --- | --- |
| App | React and TypeScript browser SPA, built with Vite and served by Firebase Hosting. |
| Image AI | Self-hosted quantized `Xenova/slimsam-77-uniform`, Transformers.js 3.8.1 and single-threaded ONNX WebAssembly in a proxy worker. No image inference API or AI API key. |
| Masks | Cached image embeddings for repeated prompts; prompt-consistent candidate filtering; model-predicted IoU ranking; connected-component selection; editable binary masks up to 512 pixels per side. |
| Planning | Conservative resize to a maximum 240-pixel grid, clearance erosion and full row-band shape envelopes. Eight deterministic greedy orders prioritize completed piece count, then nominal area. |
| Scale/export | Calibrated physical X/Y geometry and SVG millimeter units, material outline, piece labels and a 50 mm verification bar. |
| Accounts | Firebase Authentication, including anonymous guest workspaces, email/password and Google. |
| Persistence | Owner-scoped Firestore project revisions and chunked photographs, protected by deployed Firestore rules and transaction-based quota accounting. |

There is no threshold fallback or hardcoded sample mask. Loading or inference failure remains visible. The model's predicted IoU is **not measured accuracy, calibrated probability or dimensional accuracy**. Uploaded photographs stay in the browser during inference; saving a source photograph uploads it to Firebase.

## Data boundaries

Each workspace permits **50 saved revisions**, **100 photographs**, **5 MiB per photograph** and **50 MiB combined photograph bytes**. Saved input validation also bounds pattern types, quantities, masks and prompts. Photograph uploads accept JPEG/PNG and verify their signatures.

Photos are stored as bounded Firestore chunks, not Firebase Storage objects. Quota and metadata changes use atomic Firestore transactions, with rules checking matching counter transitions. Saved revisions maintain photo references. Deleting one revision retains a shared source; deleting the final reference removes the unused source and its chunks. Referenced-photo deletion is rejected. Explicit workspace erasure removes saved revisions and photos. Interrupted multi-step uploads or cleanup may need retry; atomic quota accounting does not make the entire chunk transfer atomic.

Firestore rules isolate workspaces by authenticated UID. Browser Firebase configuration is public application configuration, not an administrator credential. Never commit service-account keys. Hosting, authentication, Firestore reads/writes and image delivery have usage limits and potential costs. Chunked Firestore photo storage is suitable for this bounded release; validate storage economics and operational recovery before expanding it.

## Run locally

Use Node.js **22.13.0 or newer**, npm and a modern desktop browser.

```sh
npm ci
node scripts/download-model.mjs
npm run dev
```

Use the URL printed by Vite. For a specific port, run `npm run dev -- --port 5180`. The model downloader fetches a pinned Hugging Face revision, verifies ONNX hashes and copies the matching installed ONNX Runtime assets. Retain model licenses and provenance when deploying. Initial setup needs network access; inference does not guarantee offline operation before assets are cached.

```sh
npm test
npm run typecheck
npm run test:model
npm run build
npm start
```

`npm start` previews the static production build locally. It does not deploy. Development and preview use the configured Firebase backend unless emulators are explicitly enabled. Do not use a shared production workspace for disposable tests.

For an independent fork, create your own Firebase project and web app, replace `lib/firebase-config.json`, update `.firebaserc` and the Hosting site in `firebase.json`, and enable anonymous, email/password and Google authentication. Add your development and deployed domains to Firebase Auth's authorized domains. Deploy `firestore.rules` to your own project before testing persistence. For local Auth/Firestore emulators, start the emulators defined in `firebase.json` and set `VITE_FIREBASE_EMULATORS=1` when running Vite.

## Deploy

The live release uses Firebase Hosting site **`secondcut-studio`** within Firebase project **`kitproof`**. That project name is an infrastructure identifier; SecondCut has a separate Hosting site from the earlier application.

```sh
npx firebase login
npm run deploy
```

The deployment script runs validation and builds the SPA before publishing Hosting assets and Firestore rules. Confirm the target project/site before deploying a fork. Builds go to `dist-firebase`; `firebase.json` supplies SPA routing and asset headers. No server identity headers, D1 database or R2 bucket are required by this deployed application.

## Verification

Current recorded checks: **31 unit tests passed**, **18 real Firebase integration checks passed**, and **four actual Node model runs passed** across the two synthetic photographs, including repeated prompts sharing an image embedding. Cloud integration covered authentication, owner isolation, rejected foreign reads, photo roundtrips, saved revisions, shared-photo deletion, quota checks and guest-to-email account continuity.

- `npm test`: mask operations, malformed input rejection, calibration, conservative rectangle/ellipse geometry, physical scale, SVG and saved-input validation.
- `npm run test:model`: actual local ONNX inference on synthetic fixtures. Optional `--output FILE` and `--mask-dir DIR` write evaluation evidence, never app fallback masks.
- `npx tsx scripts/test-firebase.ts`: creates and cleans disposable accounts and records against the configured Firebase backend. This contacts the real service unless `SECONDCUT_USE_EMULATORS=1` is set. Run only against a project you control.

These checks establish bounded software behavior, not field accuracy, material savings, manufacturing tolerance or universal browser compatibility. Node inference does not replace a deployed-browser smoke test. Record the exact release revision and repeat browser segmentation, save/reopen/delete, calibration and SVG verification after deployment changes.

## Limits and product hypothesis

SecondCut targets small makers planning repeat batches from irregular remnants. Its commercial hypothesis is less time manually mapping remnants and trying layouts. Customer demand, willingness to pay and measured material savings require workshop validation. Existing products include [UMWL](https://usemorewasteless.com/leather-hide-nesting/), [Stitch Hero](https://stitch-hero.com/) and industrial [Zünd leather systems](https://www.zund.com/en/applications/interiors/turnkey-systems-for-leather-processing). This release explores a lightweight browser workflow connecting image segmentation, human correction and practical layout planning.

- Rectangles and ellipses only; fixed orientation or quarter-turn rotation. No arbitrary pattern import, seam generation, grain inference or kerf compensation.
- Scalar calibration cannot correct perspective, lens distortion, wrinkles or stretch. The material and reference must be flat and photographed square-on.
- Conservative raster approximation can leave viable pieces unplaced. The planner is a heuristic, not a global optimum or certified cutting instruction.
- Lighting, shadows, background similarity and prompts affect segmentation. Inspect every boundary and mark defects manually. The model cannot assess strength, finish, thickness or cutting safety.
- Utilization is geometric occupancy. User-entered piece value is hypothetical output value, not profit or achieved savings.
- Model memory exceeds download size. Older phones may be slow or fail. Modern desktop browsers are the initial target.

## Source and credits

Core files: `lib/segmentation.ts`, `lib/mask.ts`, `lib/nesting.ts`, `lib/calibration.ts`, `lib/project-schema.ts`, `lib/firebase-api.ts`, `lib/firebase.ts`, `firestore.rules`, and `client/`. Model revision, licenses and processing notes are in `public/models/PROVENANCE.md`; hashes are in `public/models/SHA256.json`.

SecondCut uses pretrained SlimSAM; this project did not train it. See the [paper](https://arxiv.org/abs/2312.05284), [authors' code](https://github.com/czg1225/SlimSAM), [Xenova model card](https://huggingface.co/Xenova/slimsam-77-uniform), [Transformers.js](https://github.com/huggingface/transformers.js), and [ONNX Runtime](https://github.com/microsoft/onnxruntime). The model card declares Apache-2.0; ONNX Runtime uses MIT. Retained upstream licenses govern those components, and training-data provenance is inherited from upstream SAM/SlimSAM. The original starter and third-party libraries are credited through their retained files and lockfile. No customer traction, measured ROI or production accuracy is claimed.

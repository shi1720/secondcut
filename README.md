# SecondCut

### A cutting plan for the offcut you already have

[Source repository](https://github.com/shi1720/secondcut). Planned demo: `secondcut-shivam.sg127977958.chatgpt.site`, private until publication and verification.

SecondCut helps a small leather maker work out which rectangular or elliptical blanks fit inside an irregular remnant. A photograph becomes an editable material mask through real SlimSAM image segmentation. A constrained planner arranges the requested pieces, and an SVG gives the maker a scaled plan to verify before cutting.

**Created by Shivam Gupta for Banana Hacks 2026, with Codex coding and research assistance.** This is new event work built on a standard Sites/Vinext starter and credited pretrained libraries. It is not submitted to another hackathon.

> Physical verification comes first. The model does not grade leather or find every defect. Enter a measured photo width, inspect the mask, mark unusable areas, and verify the SVG's 50 mm scale bar with a ruler. The app does not drive a cutter or certify a cut.

## Why this problem

Irregular remnants can still contain useful material, but checking what fits takes planning. SecondCut focuses on repeat batches of small leather accessories such as rectangular panels and elliptical blanks. The first value hypothesis is less time mapping a remnant and trying layouts. Material savings, customer demand and willingness to pay need real workshop validation.

Nesting software already exists. [UMWL](https://usemorewasteless.com/leather-hide-nesting/) supports manual hide mapping and SVG nesting. [ScrapFit](https://scrapfit.webbe-b.com/) plans fabric remnants. [Stitch Hero](https://stitch-hero.com/) supports photo calibration, tracing and leather CAD. [Zünd](https://www.zund.com/en/applications/interiors/turnkey-systems-for-leather-processing) combines camera capture and industrial nesting. Our experiment is a browser workflow that connects prompted image segmentation, manual correction and a practical cutting plan for small makers.

## Workflow

1. Photograph one flat remnant directly overhead on a contrasting worktop. Include its entire outline.
2. Add foreground and background prompts. SlimSAM proposes a material boundary.
3. Inspect the mask. Correct the boundary and exclude holes, weak spots or unwanted zones manually.
4. For an uploaded photo, mark two ends of a known-length reference in the same material plane and enter its millimeters. Alternatively, enter the measured width represented by the **entire photograph**. This is not the remnant's bounding-box width.
5. Enter rectangular or elliptical pattern dimensions and quantities. Fixed orientation preserves the entered direction. Allowing rotation permits quarter turns.
6. Set edge clearance and spacing, then generate a layout. Review placed and unplaced requests.
7. Check against the physical remnant, export the SVG and measure its scale bar. Sign in to save job revisions and the source photo. The app preserves the unsaved studio draft across sign-in in same-tab session storage, subject to browser storage limits.

The generated demo photos are **synthetic ImageGen fixtures**. Their assumed photo width is 300 mm, not a measurement. They are neither customer photographs nor a real-world evaluation set.

## Technical architecture

| Stage | Implementation |
| --- | --- |
| Image AI | Self-hosted quantized `Xenova/slimsam-77-uniform` ONNX model through Transformers.js 3.8.1 and browser WebAssembly. |
| Prompting | Positive/negative clicks, coordinate transformation, cached image embedding for repeated prompts. |
| Mask handling | Prompt-consistent, plausible-area candidate filtering, then model-predicted IoU selection, padded-mask postprocessing, maximum 512-pixel working mask, connected-component selection and prompt-consistency checks. |
| Geometry | Conservative resize to a maximum 240-pixel planning grid, mask erosion for edge clearance, sampled rectangle/ellipse footprints and spacing. |
| Planning | Eight deterministic greedy orders. Completed piece count is the primary objective, nominal area breaks ties. This is a bounded heuristic, not a global optimum. |
| Export | SVG with millimeter units, placed shapes, material mask, job labels and a 50 mm calibration bar. |
| Saved jobs | Owner-scoped D1 records and private R2 photographs through authenticated APIs. Saved jobs preserve inputs and masks, then recompute the plan when reopened. |
| UI/runtime | React, TypeScript and Vinext/Vite on Cloudflare Workers, using platform-owned ChatGPT sign-in. |

There is no color-threshold fallback or hardcoded demo mask. A model-loading/inference failure must remain visible. Predicted IoU is a model score, not calibrated probability, measured segmentation accuracy or physical dimensional accuracy.

### Important source locations

- `lib/segmentation.ts`: model loading, prompting, embedding cache and inference.
- `lib/mask.ts`: binary mask operations and checks.
- `lib/nesting.ts`: conservative planning and SVG export.
- `lib/project-schema.ts`: bounded saved-job validation.
- `app/api/projects/`: authenticated job CRUD.
- `app/api/photos/`: authenticated upload/read/delete.
- `db/schema.ts` and `drizzle/`: persistent schema and migrations.
- `public/models/PROVENANCE.md`: model, licensing and processing details.
- `public/models/SHA256.json`: pinned model revision, runtime version and file checksums.

## Run locally

Requirements: Node.js **22.13.0 or newer**, npm and a modern desktop browser. No AI API key is required. Initial setup needs network access for dependencies and, if absent, model assets.

```sh
npm run install:ci
node scripts/download-model.mjs
npm run dev
```

The portable development server defaults to `http://127.0.0.1:5173`. Use the URL printed by the command. To select a port:

```sh
npm run dev -- --port 5180
```

`download-model.mjs` downloads a pinned Hugging Face revision, checks ONNX hashes and copies the installed ONNX Runtime browser files. Retain model/license/provenance files when deploying. The model and WebAssembly assets are served from the application origin. Browser inference has no per-request model API fee, but asset delivery, hosting and saved-photo storage have costs. Do not assume offline operation before assets are cached.

### Accounts and persistence

Hosted authentication uses the Sites platform's injected identity through `app/chatgpt-auth.ts`. Do not expose the Worker directly behind user-forgeable identity headers. Portable loopback development offers a mock account through `/signin-with-chatgpt?return_to=/`; it is development-only and does not establish production authentication.

Saved jobs require Cloudflare bindings named **DB** (D1) and **BUCKET** (R2). Check `.openai/hosting.json` and the hosting platform configuration before deploying. The project declares DB/BUCKET bindings. Provision them through the hosting workflow and verify the resulting deployed resources. After the build generates a Worker config, apply the migration to the local database:

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_faulty_cyclops.sql
```

Apply each migration once and in order. This command updates local state only. Use the Sites platform deployment workflow for hosted bindings, production migrations and publication. `npm start` previews a built Worker locally; it does not publish.

## API and data boundaries

| Route | Behavior |
| --- | --- |
| `GET /api/projects` | List the authenticated owner's latest saved revisions, up to 50. |
| `POST /api/projects` | Save a new validated revision. Client-computed layout results do not become authoritative saved data. |
| `DELETE /api/projects?id=UUID` | Delete one owned revision and an unreferenced source photo. |
| `DELETE /api/projects` | Erase all current-owner jobs and photographs, including abandoned uploads. |
| `POST /api/photos` | Upload raw JPEG/PNG, up to 5 MiB per file. |
| `GET /api/photos/{key}` | Read an owned photo with private/no-store caching. |
| `DELETE /api/photos/{key}` | Delete an unreferenced photo. Referenced photos return a conflict. |

Server validation limits include 12 pattern types, 30 pieces/type, 100 requested pieces/job, 100 exclusions, 50 saved revisions, 100 photos and 50 MiB combined owner photo storage. Write guards check same-origin/Fetch Metadata, and streaming body limits apply even without `Content-Length`. Photographs use owner-derived namespaces plus random identifiers.

These checks are demo guardrails. Quotas are not atomic under concurrent writes. There is no global/IP rate limit, background expiry or automatic cost cap. A failed upload/save or cross-service deletion can leave an object until explicit cleanup. Strict concurrent save/delete consistency, recovery and operational abuse protection remain work before broad commercial launch.

## Verification

```sh
npm test
npm run typecheck
npm run test:model
npm run test:http
npm run lint
npm run build
```

Tests cover mask operations, reference calibration, planning geometry and saved-input validation. `test:model` executes the local model on synthetic fixtures in Node. `test:http` creates and cleans its own disposable local development records, defaults to port 5175, and requires portable mock authentication plus migrated D1/R2. Set `SECONDCUT_TEST_ORIGIN` to choose a different loopback port. It is intentionally restricted to local previews and does not validate production OAuth. Parent-reported verification: **24 unit tests passed**, **18 development HTTP checks passed**, actual Node model inference ran on two synthetic fixtures, and a compiled-browser leather journey completed segmentation, defect exclusion, review, assumed-scale confirmation, a 9-of-14 layout and a downloaded SVG parsed as 300 × 335 mm with nine pieces. A 390 px mobile viewport showed no horizontal overflow. These are bounded software checks, not a real-material accuracy study. Uploaded-reference calibration, save/reopen and hosted production checks are still being consolidated. Do not infer real-world accuracy from passing unit tests or synthetic fixtures. A release should record its exact revision, test results, actual browser model inference, owner isolation, save/reopen/delete behavior and known failures.

## Limits and responsible use

- Supported patterns are rectangles and ellipses. There is no arbitrary SVG-pattern import, polygon nesting, seam generation or kerf compensation.
- Rotation is fixed or 0/90 degrees. The app does not infer grain, stretch direction, nap, pattern matching or mirrored-piece requirements.
- A reference-derived or directly entered scalar photo-width calibration cannot correct perspective, lens distortion, wrinkles or stretch. It assumes flat material and a square-on photograph.
- Grid approximation can leave viable pieces unplaced and cannot certify submillimeter manufacturing tolerance. The exported grid scale describes planning precision, not physical accuracy.
- Boundary errors, shadows, similar backgrounds and bad prompts can include worktop or omit material. Manual review is essential.
- Exclusions are user judgments. The app cannot assess strength, finish, thickness, chemical suitability or machine-cutting safety.
- Displayed utilization is geometry occupancy. User-entered piece value is hypothetical potential output value, not profit, revenue or achieved material savings.
- Modern desktop browsers are the initial target. WebAssembly memory exceeds model download size, and older phones may be slow or fail.

## Credits and provenance

Shivam Gupta is the project creator and provides product direction. Codex assisted with coding, research and submission materials. ImageGen produced the two visibly labeled synthetic material fixtures.

SecondCut uses pretrained SlimSAM, not a model trained by this project. See the [SlimSAM paper](https://arxiv.org/abs/2312.05284), [authors' code](https://github.com/czg1225/SlimSAM), [Xenova model card](https://huggingface.co/Xenova/slimsam-77-uniform), [base model](https://huggingface.co/nielsr/slimsam-77-uniform), [Transformers.js](https://github.com/huggingface/transformers.js), and [ONNX Runtime](https://github.com/microsoft/onnxruntime). Retained upstream license files govern those components. The model card declares Apache-2.0; ONNX Runtime uses MIT. Training-data provenance comes from upstream SAM/SlimSAM.

The Sites/Vinext starter provides hosting and authentication infrastructure. Other dependencies and their exact installed versions appear in `package.json` and `package-lock.json`. This README does not relicense third-party code or assets. No customer data, interviews, traction, measured ROI or production accuracy are claimed.

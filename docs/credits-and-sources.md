# SecondCut — credits and sources

**Shivam Gupta:** project creator and product direction. **Codex:** coding, research and submission assistance. **ImageGen:** synthetic leather and fabric demo photographs. No manual coding, customer interviews or testing contributions by Shivam are invented.

## Image AI and runtime

- [SlimSAM paper](https://arxiv.org/abs/2312.05284), Zigeng Chen, Gongfan Fang, Xinyin Ma and Xinchao Wang.
- [SlimSAM authors' repository](https://github.com/czg1225/SlimSAM).
- [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform), the pinned ONNX conversion used by the build.
- [Base model card](https://huggingface.co/nielsr/slimsam-77-uniform).
- [Transformers.js](https://github.com/huggingface/transformers.js), version 3.8.1 in the project manifest.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), with retained MIT license.

The project did not train SlimSAM. The retained model card and provenance identify upstream licenses and training provenance. `public/models/PROVENANCE.md` explains inference, while `SHA256.json` records pinned assets. Paper benchmark results are not SecondCut validation results.

## Infrastructure and assets

Sites/Vinext supplies standard hosting and authentication infrastructure. React, TypeScript, Zod, Drizzle and other installed dependencies appear in the lockfile. Their own licenses remain applicable.

`public/demo/leather.png` and `public/demo/fabric.png` are ImageGen fixtures created October 11, 2026. Both show synthetic flat material on a contrasting worktop. A 300 mm photo-width assumption is illustrative. Neither image is a measured physical sample, customer photograph or accuracy dataset. Exclusion locations are manually inspected hints, not detected defects.

## Commercial research

[UMWL](https://usemorewasteless.com/leather-hide-nesting/), [ScrapFit](https://scrapfit.webbe-b.com/), [Stitch Hero](https://stitch-hero.com/), [Zünd leather workflow](https://www.zund.com/en/applications/interiors/turnkey-systems-for-leather-processing), [Zünd MindCUT](https://www.zund.com/en/software/mind).

Vendor descriptions establish competing workflows, not independent performance or demand for SecondCut. The commercial hypothesis and price experiment require validation.

## Event rules

[Devpost overview](https://banana-hacks-1111.devpost.com/), [Devpost dates](https://banana-hacks-1111.devpost.com/details/dates), [official FAQ](https://www.bananahacks.tech/faq), [conduct and submission rules](https://www.bananahacks.tech/code-of-conduct), [website schedule](https://www.bananahacks.tech/schedule).

The conduct page allows generative AI with disclosure and requires new work inside the event window. Devpost prohibits cross-submission. No prior custom project code or assets are represented as newly authored SecondCut work. Eligibility is limited to enrolled students aged 14–24 and remains unverified for the participant.

# SecondCut generated demo assets

Both images were generated with the built-in image_gen tool on 2026-10-11. They are synthetic illustrative fixtures, not customer photographs and not evidence of segmentation accuracy on physical materials.

## Assets
- outputs/secondcut/public/demo/leather.png — 1254×1254, caramel leather, broad irregular outline and one dark scar.
- outputs/secondcut/public/demo/fabric.png — 1254×1254, navy canvas, irregular outline and one pale worn patch.

## Manual points, normalized top-left coordinates
| Asset | Foreground positive point | Defect center | Suggested exclusion radius |
|---|---|---|---|
| leather.png | [0.50,0.45] | [0.694,0.668] | 0.025 |
| fabric.png | [0.50,0.45] | [0.790,0.682] | 0.030 |

These are manually inspected hints, not model detections. Both assets were inspected with view_image; exactly one flat material, clean pale tabletop, no labels or tools, full visible contour, strong color separation. Leather occupies approximately x=.03–.97,y=.065–.94; fabric x=.035–.96,y=.07–.94.

## Scale disclosure
The demo assumes the entire image width represents 300 mm. This is a synthetic calibration assumption, not a measured real material width. Production users must supply a measured image scale before relying on cut dimensions. A physical ruler is intentionally absent.

## Leather prompt
Use case: product-mockup
Asset type: synthetic test photograph for SecondCut leather offcut segmentation and cutting-plan app
Primary request: one single naturally irregular broad leather offcut lying completely flat on a clean ivory very light gray tabletop, true overhead view. Caramel brown vegetable-tanned leather with natural fine grain and subtle tonal variation. The outline fills approximately x=12% to88%, y=10% to90% of the image, broad enough to cut rectangles from, irregular angular and curving edges, no separate scraps. Include exactly one small clearly visible dark circular natural scar or hole in the leather near its lower-right quadrant, roughly x=70%,y=70%. Make that spot about 3% of image width. The surrounding leather should be unmarked.
Composition/framing: square image, orthographic-looking true top-down flat lay, all of the outline inside frame with generous plain tabletop margin, easy foreground/background separation.
Lighting: soft uniform neutral daylight, minimal short contact shadow only. Warm caramel leather against pale ivory background.
Constraints: exactly one sheet/offcut of leather. No tools, hands, people, labels, words, numbers, logos, rulers, measuring tape, stitched seams, accessories, strong shadows or gradients. This is an operational material photograph, not an advertisement.

## Fabric prompt
Use case: product-mockup
Asset type: synthetic test photograph for SecondCut fabric offcut segmentation and cutting-plan app
Primary request: a single broad naturally irregular dark navy blue woven cotton canvas fabric offcut completely flat on a clean very light ivory tabletop. True overhead flat lay. One flat continuous unwrinkled sheet with a broad useful center and irregular polygonal outer contour, mostly occupying x=12% to88% y=10% to90%, gently frayed cut edges. No pattern print, no folds, no seams, no other scraps. Subtle visible woven texture. Include exactly one small pale tan worn thin spot near lower right, roughly x=70%, y=70%, about3%image width, serving as defect exclusion.
Composition: square, true top-down, entire material within frame, clean background margin. Strong dark navy foreground against pale background, segmentation-friendly.
Lighting: soft neutral even studio light, very short minimal contact shadow.
Constraints: exactly one flat fabric offcut. No tools, hands, people, labels, text, ruler, measuring tape, logos, scissors or stitching. No decorative shadows or objects. This is a practical material photograph, not a styled advertisement.

## Provenance
Leather original: /Users/shivamgupta/.codex/generated_images/01a1298a-2c9b-7c00-be75-2e9be816b92d/exec-cdcad78a-d889-47dc-af5e-e5fc94d25c55.png
Fabric original: /Users/shivamgupta/.codex/generated_images/01a1298a-2c9b-7c00-be75-2e9be816b92d/exec-3dd862ef-ec0f-41ab-a580-fd30244b64ea.png
Project files are unmodified copies of generated originals. No previous project assets were reused.


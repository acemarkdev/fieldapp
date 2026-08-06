# Window Segment Recognition — Implementation Spec

**Audience:** engineer implementing this into the ACE surveying app.
**Version:** 1.0
**Status:** future phase (Phase 3+). Not part of the Phase 1 thin slice.

> **How it fits the product.** This feature *pre-fills the Final-Survey configuration picker* — it
> suggests the segment layout (columns × rows, structural dividers vs glazing bars, a style hint) so
> the surveyor confirms rather than builds from scratch. It never picks the final Clearview style or
> the opening type; the surveyor does. It runs as a **server-side vision service** the mobile app calls
> when online; the **manual configurator stays the always-available offline fallback**. The
> time-stamped survey photos captured from Phase 1 onward, paired with the surveyor's confirmed
> configuration, are the labelled training set for this model.

---

## 0. Scope

**In scope**

- Detect the window frame in a photo taken by a surveyor on site.
- Correct perspective distortion (photos are rarely taken square-on).
- Determine the segment layout: how many segments, their arrangement, their relative sizes.
- Distinguish structural mullions/transoms (which create *segments*) from decorative glazing bars (which do **not**).
- Emit a stable JSON contract consumed by the app UI.

**Explicitly out of scope**

- Classifying segments as fixed vs opening, and opening direction. The surveyor sets this manually in the app. Emit `opening_type: null` for every segment and let the UI collect it.

**Design priority:** deterministic and inspectable over clever. The surveyor must be able to correct any output, and the app must never silently produce a wrong segment count with high confidence.

---

## 1. Pipeline overview

```
photo
  └─> A. Frame corner detection        (ML)  -> 4 corners in image space
  └─> B. Perspective rectification     (CV)  -> fronto-parallel crop + homography H
  └─> C. Divider extraction            (CV)  -> candidate mullions/transoms/bars
  └─> D. Segment assembly + validation (CV)  -> grid, merges, review flags
  └─> E. VLM cross-check               (ML)  -> agreement score, style label
  └─> F. JSON emit
```

Stages C and D are classical computer vision, not learned. Windows are rectilinear and high-contrast, which makes projection-profile methods far more reliable and debuggable than a neural net trying to count panes. The learned components are only used where geometry can't help: finding the frame, and sanity-checking the result.

---

## 2. Stage A — Frame corner detection

**Goal:** the four outer corners of the window frame, ordered TL, TR, BR, BL, in original image pixel coordinates.

**Primary approach — keypoint detection.**
Train **RF-DETR** (Apache 2.0, `pip install rfdetr`) in keypoint mode with a single object class `window` and 4 keypoints. Keypoint regression handles occluded corners (curtains, a wheelie bin, the surveyor's own shadow) far better than contour-based methods, because the model infers where the corner *should* be.

Start with the Nano or Small checkpoint. Do not use the XL/2XL checkpoints — they ship under Roboflow's Platform Model License, not Apache 2.0.

**Fallback approach — mask to quad.**
If keypoint confidence is below threshold, run instance segmentation for the frame, take the largest mask, and reduce to a quadrilateral:

```python
cnt = max(contours, key=cv2.contourArea)
peri = cv2.arcLength(cnt, True)
for eps in (0.02, 0.03, 0.04, 0.05):
    quad = cv2.approxPolyDP(cnt, eps * peri, True)
    if len(quad) == 4 and cv2.isContourConvex(quad):
        break
```

If neither path yields a convex quadrilateral, return `status: "frame_not_found"` and ask the surveyor to re-shoot or drag the corners manually. **Manual corner adjustment must exist in the UI** — it is the single most valuable fallback in the whole system and turns a failure into a two-second fix.

**Bootstrapping training data.** Before a labelled set exists, use **Grounding DINO** (Apache 2.0) with the text prompt `"window frame"` to produce boxes, then refine to masks and derive corners. Review and correct these in Label Studio; they become the seed training set. Expect ~500 images to get usable results and ~1,500–2,000 for production reliability.

---

## 3. Stage B — Perspective rectification

This is the fix for the angle-shot problem, and it must happen **before** any segment analysis. Divider detection on an unrectified photo fails because mullions are not axis-aligned and converge toward a vanishing point.

```python
H = cv2.getPerspectiveTransform(src_quad.astype(np.float32), dst_quad.astype(np.float32))
rectified = cv2.warpPerspective(image, H, (out_w, out_h), flags=cv2.INTER_CUBIC)
H_inv = np.linalg.inv(H)
```

**Persist both `H` and `H_inv` in the output JSON.** Every geometric result is computed in rectified space, but the UI must draw overlays on the original photo, so all polygons are also emitted in original image coordinates via `H_inv`.

### 3.1 Recovering the true aspect ratio

A homography to an arbitrary rectangle gives correct *topology* but wrong *proportions* — a tall narrow window can be warped into a square. Segment counting is unaffected, but reported relative widths are, so resolve the aspect ratio in this priority order:

1. **Surveyor-supplied dimensions.** If overall width/height are already entered in the app, use them directly. This is the most accurate path and should be the default once the surveyor has measured.
2. **Vanishing-point estimation.** With focal length from EXIF, compute the two vanishing points of the frame's edge pairs and recover the rectangle's aspect ratio from the imaged quad. Standard single-view metrology; implement per Zhang's rectangle-from-single-view formulation.
3. **Fallback.** Use the mean of the quad's opposing side lengths and set `aspect_ratio_source: "estimated_from_quad"`. Flag anything downstream that depends on absolute proportions as low confidence.

Record which path was used in `rectification.aspect_ratio_source`.

### 3.2 Rejecting unusable shots

Compute the obliquity angle from the vanishing points. Beyond roughly 50° off-axis, the far edge of the window is compressed to the point where thin dividers alias away entirely and no amount of warping recovers them.

- `> 50°`: return `status: "too_oblique"` with a message asking for a squarer shot. Do not attempt analysis.
- `35°–50°`: proceed but set `needs_review: true` with reason `"oblique_capture"`.

Give the surveyor live guidance in the camera view — a simple on-screen level plus a "move square to the window" hint prevents most bad captures and is cheaper than any amount of model tuning.

### 3.3 Output resolution

Warp to a fixed longest edge of 1024 px preserving aspect ratio. Below ~800 px, glazing bars start to disappear at typical capture distances; above ~1536 px there is no accuracy gain and the projection profiles get noisier.

---

## 4. Stage C — Divider extraction

Operating on the rectified crop, in grayscale.

1. **Edge energy, split by orientation.** Apply Scharr in x and y separately. Vertical dividers appear in the x-gradient, horizontal in the y-gradient. Keeping them separate is important — a combined Canny mixes the two and blurs the profiles.

2. **Projection profiles.** Sum `|grad_x|` down each column to get a 1-D profile whose peaks are vertical dividers. Sum `|grad_y|` across each row for horizontal dividers.

3. **Peak detection.** Use `scipy.signal.find_peaks` with:
   - `prominence` at ~15% of profile range (tune on your validation set),
   - `distance` at ~3% of the relevant dimension, to avoid registering the two edges of one thick mullion as two dividers.

   The outer frame produces strong peaks at both extremes — discard peaks within 4% of the edges.

4. **Verify each candidate's extent.** A peak in the projection profile only proves that *something* vertical exists in that column band. Walk the actual edge pixels along the candidate line and record the fraction of the window height it covers. This is what allows partial dividers to be handled correctly — e.g. a transom over only the left half of a window is common and a naive full-grid assumption gets it wrong.

   - Coverage > 0.9 → full divider.
   - Coverage 0.25–0.9 → partial divider; record its span.
   - Coverage < 0.25 → discard as noise (reflection, curtain edge, a tree branch behind the glass).

5. **Measure thickness and classify.** At several sample points along each divider, measure the width of the edge response.

   - **If scale is known** (surveyor dimensions supplied): mullions and transoms are typically 45–100 mm; glazing bars, astragal bars and Georgian bars are typically 18–26 mm. Threshold at 35 mm.
   - **If scale is unknown:** classify relatively — anything under 0.5 × the median divider thickness is a glazing bar.

   This distinction matters commercially: a 6-over-6 sash window is **2 segments with glazing bars**, not 12 segments. Getting it wrong produces a nonsense quote. When thickness lands within 15% of the threshold, flag `needs_review`.

---

## 5. Stage D — Segment assembly

Build the grid from **structural dividers only** — glazing bars are recorded as a property of the segment they sit inside, never as a segment boundary.

1. Form the full grid from all full-coverage dividers.
2. Where a divider is partial, merge the cells it does not separate, and express the result with `col_span` / `row_span`. This handles the common asymmetric cases: a transom over one side only, a fixed picture pane spanning two columns beneath a row of top lights.
3. Assign each segment a stable `id` (`s1`, `s2`, …) ordered left-to-right, then top-to-bottom, so the surveyor's manual edits survive re-analysis of the same photo.
4. Count glazing bars falling inside each segment's bounds and record as `glazing_bars: {vertical: n, horizontal: n}`.

**Validation — set `needs_review: true` if any of these fire:**

| Check | Reason code |
|---|---|
| Segment count > 12 | `implausible_segment_count` |
| Any segment < 3% of total window area | `sliver_segment` |
| Divider spacing variance > 40% where a regular grid was expected | `irregular_grid` |
| Thickness within 15% of the mullion/bar threshold | `ambiguous_divider_class` |
| Obliquity 35–50° | `oblique_capture` |
| Corner keypoint confidence < 0.7 | `low_corner_confidence` |
| VLM cross-check disagrees on segment count | `vlm_disagreement` |

Never suppress a result because of a flag. Show it to the surveyor with the flag surfaced, so they confirm or correct — the round trip is fast and it builds your correction dataset for free. **Log every manual correction with the original photo.** That log is the highest-value training data you will ever get, because it is precisely the distribution of cases the model currently fails on.

---

## 6. Stage E — VLM cross-check

A second, independent opinion used only for agreement scoring and style labelling. It does **not** override the geometric result.

Run **Qwen3-VL** (Apache 2.0) locally via vLLM, or **Molmo-7B-D** (Apache 2.0) if you want stronger region grounding on a single GPU. Feed it the **rectified** crop, not the original — accuracy is materially better on a square-on image.

### Prompt

```
You are analysing a photograph of a window that has already been corrected to a
square-on view. Report only the structural segment layout.

Definitions:
- A SEGMENT is an area of the window separated from its neighbours by a thick
  structural frame member (a mullion if vertical, a transom if horizontal).
- A GLAZING BAR is a thin decorative divider inside a single pane of glass.
  Glazing bars do NOT create segments. A window with one pane of glass divided
  by six thin bars is ONE segment, not seven.
- If unsure whether a divider is structural or decorative, judge by thickness
  relative to the outer frame: structural members are of similar visual weight
  to the outer frame, decorative bars are markedly thinner.

Return ONLY a JSON object, no preamble, no markdown fences:

{
  "segment_count": <integer>,
  "columns": <integer>,
  "rows": <integer>,
  "layout_description": "<short plain-English description, e.g. '2 columns with a transom over the left column only'>",
  "window_style": "<one of: casement, sash, tilt_and_turn, bay, bow, french_door, patio_slider, fixed_light, roof_light, other>",
  "has_glazing_bars": <boolean>,
  "confidence": <float 0.0-1.0>,
  "notes": "<anything ambiguous or unusual, or empty string>"
}
```

Set `temperature: 0`. Parse defensively — strip stray fences, and on a parse failure record `vlm.status: "parse_failed"` and carry on. The VLM must never be able to block the pipeline.

---

## 7. Output JSON contract

```json
{
  "schema_version": "1.0",
  "status": "ok",
  "image": {
    "source_id": "IMG_4821.jpg",
    "width": 4032,
    "height": 3024,
    "captured_at": "2026-08-06T09:14:22Z"
  },
  "frame": {
    "corners_image_space": [[812,634],[3104,712],[3061,2588],[798,2461]],
    "corner_confidence": 0.94,
    "detector": "rfdetr_keypoint_v1"
  },
  "rectification": {
    "applied": true,
    "homography": [[0.94,0.03,-762.1],[0.01,0.97,-598.4],[0.0,0.0,1.0]],
    "homography_inverse": [[1.06,-0.03,798.2],[-0.01,1.03,612.7],[0.0,0.0,1.0]],
    "obliquity_degrees": 18.4,
    "aspect_ratio": 1.42,
    "aspect_ratio_source": "surveyor_dimensions",
    "rectified_size": [1024, 721]
  },
  "layout": {
    "columns": 3,
    "rows": 2,
    "column_widths_relative": [0.28, 0.44, 0.28],
    "row_heights_relative": [0.30, 0.70],
    "regular_grid": false
  },
  "segments": [
    {
      "id": "s1",
      "grid_position": {"col": 0, "row": 0},
      "col_span": 1,
      "row_span": 1,
      "bbox_rectified_normalised": [0.02, 0.02, 0.28, 0.30],
      "polygon_image_space": [[812,634],[1456,656],[1441,1218],[806,1190]],
      "area_fraction": 0.084,
      "glazing_bars": {"vertical": 0, "horizontal": 0},
      "opening_type": null,
      "opening_direction": null
    }
  ],
  "dividers": [
    {
      "id": "d1",
      "orientation": "vertical",
      "class": "mullion",
      "position_relative": 0.28,
      "coverage": 1.0,
      "thickness_mm": 62,
      "thickness_confidence": 0.88
    },
    {
      "id": "d2",
      "orientation": "horizontal",
      "class": "transom",
      "position_relative": 0.30,
      "coverage": 0.44,
      "span_relative": [0.0, 0.44],
      "thickness_mm": 58,
      "thickness_confidence": 0.91
    }
  ],
  "vlm_crosscheck": {
    "status": "ok",
    "model": "qwen3-vl",
    "segment_count": 5,
    "window_style": "casement",
    "agrees_with_geometry": true,
    "confidence": 0.86
  },
  "confidence": 0.89,
  "needs_review": false,
  "review_reasons": [],
  "processing_ms": 1840
}
```

### Field contract notes

- `status` is one of `ok`, `frame_not_found`, `too_oblique`, `error`. On anything other than `ok`, `segments` is an empty array and `review_reasons` explains why.
- `opening_type` and `opening_direction` are **always** `null` from this pipeline. They exist in the schema so the surveyor's app-side input writes into the same object with no shape change. Reserve `opening_type` values: `fixed`, `casement`, `tilt_and_turn`, `top_hung`, `bottom_hung`, `sliding`, `sash`.
- `polygon_image_space` is always present and always in **original** photo coordinates — the UI should never need to apply the homography itself.
- `confidence` is the product of corner confidence, divider classification confidence, and a VLM agreement factor. Clamp to `[0.0, 1.0]`.
- `thickness_mm` is `null` when scale is unknown; in that case classification used relative thickness and `thickness_confidence` should be reduced accordingly.

---

## 8. Dependencies and licensing

This is shipping commercially, so licence compatibility is a hard requirement, not a preference.

| Package | Purpose | Licence |
|---|---|---|
| `opencv-python` | Rectification, edge detection, contours | Apache 2.0 |
| `rfdetr` | Corner keypoints, frame segmentation | Apache 2.0 (Nano/Small/Medium/Large only) |
| `numpy`, `scipy` | Profiles, peak finding | BSD |
| `transformers` + `vllm` | Qwen3-VL / Molmo serving | Apache 2.0 |
| `pillow`, `piexif` | EXIF focal length | HPND / MIT |

**Do not use `ultralytics` / YOLO26.** It is AGPL-3.0, which would require releasing the app's source. If a YOLO-family architecture is genuinely wanted later, use **YOLOX** (Apache 2.0) instead, or buy an Ultralytics commercial licence.

**Check before shipping:** SAM 3 and DINOv3 are under custom Meta licences, not Apache. They are useful for offline label generation, but keep them out of the shipped inference path unless the terms have been reviewed.

---

## 9. Build order

1. **Rectification + divider extraction on manually-clicked corners.** No ML at all. Prove the geometry works on 30 real site photos. If projection profiles can't find the mullions on a square-on photo, nothing downstream will save it.
2. **VLM cross-check.** Cheap to add, immediately useful, and gives a baseline to measure the geometry against.
3. **Corner keypoint model.** Only once stages 1–2 are solid, because until then you don't know what corner accuracy you actually need.
4. **Correction-log retraining loop.**

Ship stage 1 behind a "tap the four corners" UI. It is genuinely usable on day one and it collects the training data for stage 3.

---

## 10. Acceptance tests

Build a fixture set of 50 real photos spanning: square-on, 20° oblique, 40° oblique, backlit, rain on glass, curtains visible behind, a 6-over-6 sash, a window with a partial transom, and a bay window.

- Segment count exact-match ≥ 90% on square-on and 20° shots.
- No case where an incorrect segment count is returned with `needs_review: false` and `confidence > 0.85`. **This is the critical test** — a confidently wrong answer that reaches a quote is far more damaging than a flagged uncertain one.
- Glazing bars never counted as segments on the sash fixture.
- End-to-end under 3 s on target hardware.
- Every `status != "ok"` path returns a schema-valid object with an actionable message.

---

## 11. Note on the bay window case

Bays are the known hard case and should be treated as out of scope for v1. A bay is multiple windows at angles to each other, so a single homography cannot rectify them — each facet needs its own. Detect the case (VLM returns `window_style: "bay"`, or corner detection finds more than one strong quad) and return `status: "ok"` with `needs_review: true`, reason `"bay_window_multi_facet"`, prompting the surveyor to photograph each facet separately. Trying to force a bay through the single-homography path produces plausible-looking but wrong output, which is the worst possible failure mode.

---

## 12. Integration with the ACE app (added in review)

- **Where it plugs in:** the recognition JSON pre-fills the Final-Survey **configuration picker** — it sets the product/lights palette filter and the cell grid (`columns` × `rows`), highlights the likely **Clearview styles**, and records glazing bars. The surveyor confirms and, critically, still selects the exact **Clearview style number** (which drives ordering and pricing) and the **opening type** per segment.
- **Deployment:** a **server-side vision service** the mobile app calls with the photo. The geometry path is cheap CPU; the VLM needs a GPU (a real hosting cost), so ship geometry-only first and add the VLM later.
- **Offline:** the field app is offline-first, so recognition is an **online-only assist**; the manual configurator remains the always-available path. Never block survey completion on it.
- **Data flywheel:** every survey photo captured from Phase 1 onward, paired with the surveyor's confirmed configuration, is labelled training data. Shipping manual capture now is the data-collection phase for this model — a proprietary dataset and a genuine moat.

# Frame-Type Recognition — Data & Model Strategy

**Audience:** Radek + whoever builds the recognition feature.
**Status:** planning. Complements `docs/window-segment-recognition.md` (the inference pipeline).
**This doc answers:** with lots of *loose, unlabelled* photos and a live field app, how do we build,
label, train, and continuously improve the model — without a separate data-collection app?

---

## 0. TL;DR — the recommendation

1. **Don't build a separate "photo collection" app.** The ACE field app already captures a **photo + the surveyor's confirmed spec** for every item. That pair *is* a labelled training example. Instrument the app you have; it's a self-labelling data flywheel and a genuine competitive moat.
2. **Don't train from scratch to get value.** Ship a **VLM assist** first (no training, no labels): the app sends the photo to a vision-language model that returns the segment layout + style, and the surveyor confirms. Useful on day one; every correction is a gold label.
3. **Labels, not images, are the bottleneck.** You have plenty of images. The work is turning them into consistent labels. Do that **cheaply with auto-labelling** (a VLM/Grounding-DINO proposes, a human verifies) rather than hand-drawing on 2,000 photos.
4. **Fine-tune only when there's a reason** — cheaper inference, on-device, or **offline** (a cloud VLM is useless in a basement, which is exactly where surveys happen). By then the flywheel has given you the dataset.

The rest of this doc is the how.

---

## 1. What are we actually recognising? (and what needs labels)

"Frame-type recognition" is really **four sub-tasks**, each with different label needs. Be explicit about which we're doing, because the labelling effort differs by 10×.

| Sub-task | Output | Label needed | Where it's used |
|---|---|---|---|
| **A. Frame corners** | 4 corner points | keypoints / masks per photo | rectify the photo (spec §2–3) |
| **B. Segment layout** | columns × rows, dividers, glazing bars | grid annotation per photo | pre-fill the config-picker grid |
| **C. Style class** | casement / sash / bay / … | one label per photo | palette filter + Clearview hint |
| **D. Catalogue map** | likely Clearview style number(s) | style ↔ photo (from orders) | ordering/pricing shortlist |

Notes that shape the plan:
- **C (style) is the cheapest to label and the easiest win** — a single tag per photo, and a VLM does it well zero-shot. Start here.
- **A + B are the spec's core** and mostly **classical CV** once corners are found; the only *learned* part is corner detection (A) and the VLM cross-check.
- **D needs your business data** (which style was ordered for that photo). Loose photos can't provide it; the flywheel and historical orders can.
- **Scale-dependent labels** (mullion thickness in mm, true aspect ratio) need **surveyor-entered dimensions** — so those labels come from the **field app**, not from loose photos. Loose photos are best for corners, topology, and style.

---

## 2. Starting position

- **Asset:** a large library of loose window photos, **no attached frame type/spec**.
- **Asset:** a shipping field app (v0.6.0) that already stores, per item, a **photo + confirmed spec** in Supabase — and now works **offline**.
- **Gap:** no labels on the loose photos; no trained model yet.
- **Constraint:** it ships commercially → **Apache-2.0 (or more permissive) only** in the *inference* path (see §10). Custom-licensed models (SAM 3, DINOv3) may be used for *offline labelling* only.

---

## 3. Guiding principles

- **Human-in-the-loop from day one.** The surveyor confirms/corrects every suggestion; nothing is auto-accepted into a quote. Corrections are the best labels you'll get — they're exactly the cases the model fails on (spec §5).
- **Auto-label, then verify.** Machines propose, humans dispose. Verifying a proposed label is ~10× faster than creating one from scratch.
- **One taxonomy, versioned.** Freeze the class list and JSON schema before mass labelling; changing it later re-works every label.
- **Balance beats volume.** 300 balanced, verified images beat 2,000 that are 90% plain double-casements. Rare configs (bays, arches, coupled units, partial transoms) must be deliberately sourced.
- **Split by *property/job*, not by photo,** so near-duplicate shots of the same window don't leak between train and test.

---

## 4. Phased plan (each phase ships value on its own)

### Phase A — VLM assist (now; zero training)
- App (online) sends the survey photo to a **VLM** that returns the spec's Stage-E JSON (segment_count, columns, rows, style, glazing bars, confidence).
- Surveyor confirms/edits → writes into the item.
- **Value:** faster surveys immediately. **Data:** every confirmation/correction is a label.
- **Cost:** GPU/API inference. For the SaaS story, prefer a **self-hostable open VLM** (Qwen-VL-family / Molmo, per spec §6) so customer photos don't leave your infra.

### Phase B — data flywheel (mostly already built)
- Persist `photo + confirmed config + corrections` as training records in Supabase.
- Nightly/weekly **export** to a labelling/versioned dataset store.
- **Value:** a growing, proprietary, correctly-distributed dataset with no extra labelling labour.

### Phase C — fine-tune (only when justified)
- Train **RF-DETR keypoints** for corners (spec §2) and, optionally, a small **style classifier** (C).
- Triggers to do this: inference **cost**, **on-device** speed, or **offline** capability (the big one).
- Auto-label the corner/style data with Grounding DINO + the VLM, human-verify, then train.

> Offline note: because surveys happen with no signal, the *end state* is a small model running **on the phone**. That's a Phase-C fine-tune/distillation, and it's the main reason to eventually move beyond the cloud VLM. The offline-queue work we already did is the plumbing that makes an on-device assist viable later.

---

## 5. Labelling strategy (from loose photos → gold labels)

**Pipeline:** ingest → auto-propose → human-verify → dataset.

1. **Ingest & clean.** Load photos into a labelling project. Auto-drop junk (blurry, no window, duplicates via perceptual hash).
2. **Auto-propose:**
   - **Corners (A):** Grounding DINO (`"window frame"`, Apache-2.0) → box → mask → quad → 4 corners (spec §2 bootstrapping).
   - **Layout + style (B, C):** the **VLM** with the spec §6 prompt → proposed grid + style.
3. **Human-verify in Label Studio** (open source). The reviewer *accepts or nudges* — corners get dragged, a wrong style is re-tapped. Fast because the answer is pre-filled.
4. **Emit dataset:** COCO/keypoint JSON for A, image-folder or JSONL for C, the spec's layout JSON for B.

**Who labels?** A small number of trained ACE surveyors are ideal (they know a mullion from a glazing bar — the commercially critical distinction, spec §4). Budget a few focused sessions; verifying is quick.

**How many?** Per the spec: ~**500** verified images for usable corner detection, ~**1,500–2,000** for production. Style classification needs far fewer per class (~100–200/class) to start. Hold out a **200–300 image gold eval set** first and never train on it.

---

## 6. Bootstrapping from the loose photo library (concrete steps)

Because they're unlabelled, treat them as **raw material for auto-labelling + the eval set**, not as ready data.

1. **Curate:** de-dupe, drop non-windows/blurry, keep a spread of styles and capture angles.
2. **Stratify:** bucket by apparent style/complexity (the VLM's zero-shot style tag is good enough for bucketing) so you can sample evenly and find the rare cases.
3. **Build the gold eval set first:** hand-verify ~250 across the buckets (incl. hard cases from spec §10 — 6-over-6 sash, partial transom, bay, oblique, backlit, rain, curtains). This is your yardstick for every later model.
4. **Seed the train set:** auto-label the rest, human-verify in priority order (rare/hard first).
5. **Flag what loose photos can't give you:** true mm scale and aspect ratio (no dimensions/EXIF trust). Mark those fields unknown; they'll be filled by the flywheel where the surveyor entered dimensions.

Deliverable of this stage: a **versioned dataset v0** (gold eval + seed train) + a labelling runbook.

---

## 7. The data flywheel (operationalising the app)

Already ~built; to finish it for training:
- **Capture (done):** item photo(s) in Storage, spec in `survey_items`.
- **Add:** when the surveyor confirms/edits a VLM suggestion, store both the **suggestion** and the **final** (a correction pair) — that's the high-value signal (spec §5).
- **Export job:** periodically emit `{photo, corners?, layout?, style, dimensions?, corrections}` to the dataset store, tagged with schema + model version.
- **Retrain loop:** on a cadence, fold new verified data in, re-train, evaluate against the frozen gold set, ship if it beats the incumbent.

This is the moat: a proprietary, self-labelling, correctly-distributed dataset that grows every working day.

---

## 8. Dataset design

- **Taxonomy (freeze before mass labelling):** style classes (start with the spec's list: casement, sash, tilt_and_turn, bay, bow, french_door, patio_slider, fixed_light, roof_light, other) and the layout schema from spec §7. Map styles → **Clearview** catalogue groups.
- **Schema:** reuse the spec's Stage-E / output JSON so labels, model output, and app input are the same shape.
- **Splits:** train/val/test by **job/property**, ~70/15/15; gold eval separate and immutable.
- **Balance targets:** cap the common double-casement; over-sample rare configs.
- **Versioning:** dataset versions (v0, v1…) with a manifest (counts per class, source, labeller, date). Never silently mutate a released version.
- **Storage:** a dedicated private Supabase bucket / object store; keep raw photo + label + provenance together.

---

## 9. Privacy, consent, governance (do not skip — it's a SaaS)

- Window photos often show **interiors, occupants, house numbers**. Define **consent** (survey T&Cs), **retention**, and **access** before amassing a training set.
- Keep the **training corpus tenant-segregated**; be explicit in customer contracts about whether their photos may train shared models (many enterprise customers will say no — design for per-tenant models or opt-in).
- Prefer **self-hosted** inference so photos aren't sent to third-party APIs; if a hosted VLM is used in Phase A, disclose it and pick a no-training-on-your-data tier.
- Strip/normalise EXIF GPS on export unless you need it.

---

## 10. Licensing (recap — hard requirement)

From spec §8, held here too: inference path is **Apache-2.0 or more permissive** (OpenCV, RF-DETR Nano–Large, YOLOX not Ultralytics, Qwen-VL/Molmo, numpy/scipy). **SAM 3 / DINOv3** (custom Meta licences) are allowed **only for offline label generation**, never in the shipped path, and only after the terms are reviewed. Cloud VLM APIs: check data-use terms.

---

## 11. Tooling & infra

- **Labelling:** Label Studio (open source).
- **Auto-label:** Grounding DINO (corners), the chosen VLM (layout/style).
- **Training:** RF-DETR (corners), a small timm/torch classifier (style); standard augmentation.
- **Serving (Phase A/C cloud):** vLLM for the VLM; a light CPU service for the CV geometry (spec §12).
- **Data store:** Supabase Storage + a dataset manifest; export to COCO/JSONL.
- **Experiment tracking:** anything simple (a CSV/Weights-&-Biases-style log) keyed to dataset version.

---

## 12. Metrics & acceptance

Reuse the spec's acceptance tests (§10) as the model bar. Add dataset-level tracking:
- **Style classifier:** per-class precision/recall on the gold set; watch the rare classes.
- **Corners:** mean corner error (px, normalised); % frames rectified successfully.
- **Layout:** segment-count exact-match (the number that matters commercially); **zero** confidently-wrong high-confidence cases (spec's critical test).
- **Flywheel health:** correction rate over time (should fall), coverage of rare classes (should rise).

---

## 13. What to do first (sequencing)

1. **Freeze taxonomy + JSON schema** (aligns app, labels, model). ← small, unblocks all else
2. **Phase A VLM assist** wired to one captured photo → returns Stage-E JSON. ← proves value, starts label collection
3. **Bootstrap dataset v0** from the loose library (auto-label → verify gold set).
4. **Extend the flywheel** to store suggestion+correction pairs and export.
5. **Phase C fine-tune** (corners first, then style) when cost/offline demands it.

Roughly: 1–2 are days of work each; 3 is the ongoing labelling effort; 5 is a project in its own right.

---

## 14. Open decisions (for Radek)

- **Glass options** — the exact ACE glass list for the picker (also a label field).
- **On-device target** — do we commit to an offline on-phone model (Phase C), or is online-only assist acceptable for now?
- **Hosting** — self-hosted open VLM (GPU cost, data stays in-house) vs a hosted VLM API (cheaper to start, data-use to vet) for Phase A.
- **Who labels** and how many surveyor-hours we can allocate to verification.
- **Per-tenant vs shared models** — the contractual/privacy stance that shapes the whole dataset design.

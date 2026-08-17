// Frozen taxonomy + schema for photo → window layout recognition (Phase A: VLM assist).
// This is the contract shared by the vision service, the office API, and (later) the mobile app.
// See docs/frame-recognition-data-strategy.md and docs/window-segment-recognition.md.

export type WindowStyle =
  | 'casement' | 'sash' | 'tilt_and_turn' | 'bay' | 'bow'
  | 'french_door' | 'patio_slider' | 'fixed_light' | 'roof_light' | 'other';

export const WINDOW_STYLES: WindowStyle[] = [
  'casement', 'sash', 'tilt_and_turn', 'bay', 'bow',
  'french_door', 'patio_slider', 'fixed_light', 'roof_light', 'other',
];

// What the vision model returns for one photo. Deliberately the same shape the mobile
// config-picker consumes, so the surveyor confirms/edits without a data reshape.
export interface RecognitionResult {
  segment_count: number;
  columns: number;
  rows: number;
  layout_description: string;
  window_style: WindowStyle | string;
  has_glazing_bars: boolean;
  confidence: number; // 0..1 (model's own)
  notes: string;
}

// Prompt for a raw (un-rectified) site photo. Kept strict about the mullion-vs-glazing-bar
// distinction because getting that wrong changes the segment count — and the quote.
export const RECOGNITION_PROMPT = `You are a window-surveyor's assistant. Analyse the photograph of a single window or door taken on site. The photo may be slightly angled rather than perfectly square-on. Report ONLY the structural segment layout of the main window/door in the image; ignore the surrounding wall, sky, furniture, etc.

Definitions:
- A SEGMENT is an area separated from its neighbours by a thick STRUCTURAL frame member (a mullion if vertical, a transom if horizontal).
- A GLAZING BAR is a thin DECORATIVE divider inside a single pane of glass. Glazing bars do NOT create segments. A single pane divided by six thin bars is ONE segment, not seven.
- If unsure whether a divider is structural or decorative, judge by thickness relative to the outer frame: structural members are similar in visual weight to the outer frame; decorative bars are markedly thinner.

Return ONLY a JSON object, with no preamble and no markdown fences:
{
  "segment_count": <integer>,
  "columns": <integer>,
  "rows": <integer>,
  "layout_description": "<short plain-English description, e.g. '2 columns with a transom over the left column only'>",
  "window_style": "<one of: casement, sash, tilt_and_turn, bay, bow, french_door, patio_slider, fixed_light, roof_light, other>",
  "has_glazing_bars": <boolean>,
  "confidence": <float 0.0-1.0>,
  "notes": "<anything ambiguous or unusual, or an empty string>"
}`;

// Defensive parse: strip stray fences/preamble and pull out the JSON object. Never trust
// the model to return clean JSON.
export function parseRecognition(text: string): RecognitionResult {
  let s = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  const o = JSON.parse(s);
  return {
    segment_count: Number(o.segment_count ?? 0),
    columns: Number(o.columns ?? 0),
    rows: Number(o.rows ?? 0),
    layout_description: String(o.layout_description ?? ''),
    window_style: String(o.window_style ?? 'other'),
    has_glazing_bars: !!o.has_glazing_bars,
    confidence: Number(o.confidence ?? 0),
    notes: String(o.notes ?? ''),
  };
}

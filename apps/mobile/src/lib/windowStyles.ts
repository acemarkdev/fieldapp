// Window/door style catalogue with sketched layouts for the visual "Choose type" picker.
// Each style draws in a 0..100 (x) by 0..70 (y) box; the frame is the rect [6,6]→[94,64].
// `lines` are internal mullions / transoms / opening indicators as [x1,y1,x2,y2].
// `type` filters the top toggle (Window / Door / Tilt & turn); `lights` the 1 / 2 / 3+ toggle.

export type StyleType = 'window' | 'door' | 'tilt';
export interface WindowStyle {
  number: string;        // e.g. "Style 24" — stored on the item as design_code
  name: string;          // short label, e.g. "2L · C+F"
  type: StyleType;
  lights: 1 | 2 | 3;     // 3 == "3+"
  windowType: string;    // maps to survey_items.window_type (Casement, Tilt & Turn, …)
  lines: number[][];     // internal sketch segments
  accent?: boolean;      // draw the sketch in the accent colour (tilt & turn)
}

// geometry helpers (frame corners / mids)
const L = 6, R = 94, T = 6, B = 64, MY = 35;
const casementL = (x0: number, x1: number) => [[x1, T, x0, MY], [x1, B, x0, MY]];      // side-hung, hinge left → apex left
const casementR = (x0: number, x1: number) => [[x0, T, x1, MY], [x0, B, x1, MY]];      // side-hung, hinge right → apex right
const topHung = (x0: number, x1: number) => { const m = (x0 + x1) / 2; return [[x0, B, m, T], [x1, B, m, T]]; };
const mullion = (x: number, y0 = T, y1 = B) => [[x, y0, x, y1]];

export const WINDOW_STYLES: WindowStyle[] = [
  // ---- single light ----
  { number: 'Style 1', name: 'Fixed', type: 'window', lights: 1, windowType: 'Fixed / Direct Glazed', lines: [] },
  { number: 'Style 3', name: 'Side L', type: 'window', lights: 1, windowType: 'Casement', lines: casementL(L, R) },
  { number: 'Style 2', name: 'Side R', type: 'window', lights: 1, windowType: 'Casement', lines: casementR(L, R) },
  { number: 'Style 6', name: 'Top hung', type: 'window', lights: 1, windowType: 'Top Hung', lines: topHung(L, R) },
  // ---- two lights ----
  { number: 'Style 24', name: '2L · C+F', type: 'window', lights: 2, windowType: 'Casement', lines: [...mullion(50), ...casementL(L, 50)] },
  { number: 'Style 25', name: '2L · F+C', type: 'window', lights: 2, windowType: 'Casement', lines: [...mullion(50), ...casementR(50, R)] },
  { number: 'Style 23', name: 'Twin', type: 'window', lights: 2, windowType: 'Top Hung', lines: [...mullion(50), ...topHung(L, 50), ...topHung(50, R)] },
  { number: 'Style 32', name: 'Transom', type: 'window', lights: 2, windowType: 'Casement', lines: [[L, 24, R, 24], [50, 24, 50, B]] },
  // ---- three+ lights ----
  { number: 'Style 40', name: '3L · C+F+C', type: 'window', lights: 3, windowType: 'Casement', lines: [...mullion(35), ...mullion(65), ...casementL(L, 35), ...casementR(65, R)] },
  { number: 'Style 41', name: '3L Fixed', type: 'window', lights: 3, windowType: 'Fixed / Direct Glazed', lines: [...mullion(35), ...mullion(65)] },
  // ---- tilt & turn ----
  { number: 'Style 201', name: 'Tilt & turn', type: 'tilt', lights: 1, windowType: 'Tilt & Turn', accent: true, lines: [...casementR(L, R), [L, B, 50, T], [R, B, 50, T]] },
  { number: 'Style 202', name: 'T&T twin', type: 'tilt', lights: 2, windowType: 'Tilt & Turn', accent: true, lines: [...mullion(50), ...casementR(L, 50), [L, B, 28, T], ...casementR(50, R), [50, B, 72, T]] },
  // ---- doors ----
  { number: 'Style D1', name: 'Single door', type: 'door', lights: 1, windowType: 'Residential Door', lines: [[L, B, R, T]] },
  { number: 'Style D2', name: 'French door', type: 'door', lights: 2, windowType: 'French Door', lines: [...mullion(50), [L, B, 50, T], [R, B, 50, T]] },
];

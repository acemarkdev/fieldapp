// The style drawing (Clearview sketch catalogue, apps/mobile/assets/styles/<code>.png) that goes to
// monday's "Design Sketch" column when an item is synced. Pure decisions here; promote.ts does the upload.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../mobile/assets/styles');

/** Catalogue key for a design code: "24", "Style 24" and "style24" all mean sketch 24. Null when blank or unsafe. */
export function styleSketchKey(designCode: unknown): string | null {
  const key = String(designCode ?? '').trim().replace(/^style\s*/i, '').trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(key) && !key.includes('..') ? key : null;
}

export interface SketchItem { kind?: string | null; design_code?: string | null; style_sketch_pushed?: string | null }

/** Which drawing (if any) this sync should upload: the item's style, unless that same drawing was
 *  already sent for it. Snag rows never get one. `has` says whether the catalogue holds the drawing.
 *  Returns null while the tracking column is missing (migration 0067 not run) — otherwise every
 *  re-sync would add the same file again. */
export function sketchToPush(item: SketchItem, has: (key: string) => boolean = hasStyleSketch): string | null {
  if (!('style_sketch_pushed' in item)) return null;
  if (item.kind === 'snag') return null;
  const key = styleSketchKey(item.design_code);
  if (!key || item.style_sketch_pushed === key) return null;
  return has(key) ? key : null;
}

export const hasStyleSketch = (key: string) => existsSync(join(STYLES_DIR, `${key}.png`));
export const readStyleSketch = (key: string) => new Uint8Array(readFileSync(join(STYLES_DIR, `${key}.png`)));

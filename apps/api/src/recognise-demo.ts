// Try the vision assist on a photo, a whole folder of photos, or an item's photo.
//
//   node --env-file=.env --import tsx apps/api/src/recognise-demo.ts "/path/to/window.jpg"
//   node --env-file=.env --import tsx apps/api/src/recognise-demo.ts "/path/to/folder"      (runs every image, prints a table)
//   node --env-file=.env --import tsx apps/api/src/recognise-demo.ts item:<itemId>          (uses that item's latest photo)
//
// Needs VISION_API_URL / VISION_MODEL (+ VISION_API_KEY) in .env, and — for item:<id> — the Supabase keys.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { recogniseImage, recogniseItemPhoto } from './recognise';
import type { RecognitionResult } from '@ace/shared';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const arg = process.argv[2];
if (!arg) {
  console.error('usage: recognise-demo <image | folder | item:<itemId>>');
  process.exit(1);
}

function tableRow(name: string, r: RecognitionResult) {
  console.log(
    name.slice(0, 32).padEnd(34) +
    String(r.segment_count).padStart(4) + '   ' +
    `${r.columns}x${r.rows}`.padEnd(6) +
    String(r.window_style).slice(0, 14).padEnd(16) +
    (r.has_glazing_bars ? 'yes' : 'no').padEnd(5) +
    r.confidence.toFixed(2),
  );
}

async function recogniseFile(path: string): Promise<RecognitionResult> {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error('unsupported type (use jpg/png/webp; convert HEIC first)');
  return recogniseImage(new Uint8Array(readFileSync(path)), mime);
}

async function main() {
  if (arg.startsWith('item:')) {
    console.log(JSON.stringify(await recogniseItemPhoto(arg.slice(5)), null, 2));
    return;
  }
  const st = statSync(arg);
  if (st.isDirectory()) {
    const files = readdirSync(arg).filter((f) => MIME[extname(f).toLowerCase()]).sort();
    if (files.length === 0) { console.log('(no jpg/png/webp images in that folder)'); return; }
    console.log('FILE'.padEnd(34) + 'SEGS   GRID  STYLE           BARS CONF');
    console.log('-'.repeat(72));
    let ok = 0;
    for (const f of files) {
      try { tableRow(f, await recogniseFile(join(arg, f))); ok++; }
      catch (e: any) { console.log(basename(f).slice(0, 32).padEnd(34) + '  ERROR: ' + (e?.message ?? e)); }
    }
    console.log('-'.repeat(72));
    console.log(`${ok}/${files.length} analysed`);
  } else {
    // single file — print the full JSON (layout_description + notes are useful for one photo)
    console.log(JSON.stringify(await recogniseFile(arg), null, 2));
  }
}

main().catch((e) => { console.error('Error:', e?.message ?? e); process.exit(1); });

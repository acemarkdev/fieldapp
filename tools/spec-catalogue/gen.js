// Builds packages/shared/src/specCatalogue.ts from the Spec Matrix fields + the decisions ticked in it.
// Usage: node tools/spec-catalogue/gen.js <decisions-dir> packages/shared/src/specCatalogue.ts
//   <decisions-dir> holds one JSON file per matrix row (bay.addon.json …), exported from the Spec
//   Matrix artifact's "decisions" collection. matrix.json is the matrix's field list.
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const { F, GROUPS } = JSON.parse(fs.readFileSync(path.join(DIR, 'matrix.json'), 'utf8'));
const DEC_DIR = process.argv[2];
const dec = {};
for (const f of fs.readdirSync(DEC_DIR)) { const d = JSON.parse(fs.readFileSync(path.join(DEC_DIR, f), 'utf8')); dec[f.replace(/\.json$/, '')] = d; }

const TYPE_NAME = { door: 'Door', cas: 'Casement', flush: 'Flush Casement', flusho: 'Flush Casement Optima', patio: 'Patio', shaped: 'Shaped', bay: 'Bay' };
const WHO = { O: 'office', M: 'mapper', S: 'surveyor' };

// Fields handled elsewhere (item code / drawing / counted), never a spec parameter.
const DROP = new Set(['location', 'qty', 'sketch', 'pages']);
// Item-level values that already live in a survey_items column.
const COLUMN = { width: 'width_mm', pw: 'width_mm', height: 'height_mm', phin: 'height_mm', mullion: 'mullion1_mm', transom: 'transom1_mm',
  cill: 'cill_depth', extcill: 'cill_depth', tl: 'safety_glass', glass: 'glass', openinout: 'open_in_out', notes: 'comments', addetails: 'comments' };
// Input kind overrides (default: choice when the options read "A / B / C", number when unit mm, else text).
const YESNO = ['Yes', 'No'];
const KIND = {
  // header
  quoteorder: ['choice', ['Quote', 'Order']], delivery: ['date'],
  // regs
  worktype: ['choice', ['Replacement', 'New build', 'Extension']],
  uvalue: ['text'], glazunit: ['text'], existvents: ['choice', YESNO], bedrooms: ['number'], storeys: ['choice', ['Single floor', 'Multiple floors']],
  mechvent: ['choice', ['None', 'Intermittent extract', 'Continuous MEV', 'MVHR']],
  roomvent: ['choice', ['No minimum', '4,000 mm²', '8,000 mm²', '10,000 mm²']], ventcount: ['number'], ventheight: ['text'], nightlatch: ['text'],
  roomtype: ['choice', ['Bedroom', 'Living', 'Kitchen', 'Bathroom', 'WC', 'Utility', 'Hall / landing']], roomarea: ['number', null, 'm²'],
  purge: ['text'], floorlevel: ['text'], escape: ['choice', ['Required', 'Not required']], fireboundary: ['choice', YESNO],
  sillheight: ['number', null, 'mm'], safetyglass: ['choice', ['Not required', 'Toughened', 'Laminated']], guarding: ['choice', ['Not required', 'Restrictor', 'Guarding']],
  parto: ['choice', ['Applies', 'Does not apply']], orientation: ['choice', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']], highrisk: ['choice', YESNO],
  crossvent: ['choice', YESNO], gvalue: ['text'], noise: ['choice', ['Normal', 'Road / street', 'Rail', 'Flight path']], acousticrw: ['text', null, 'dB'],
  sbdreq: ['choice', ['None', 'PAS 24:2022', 'Secured by Design']], doorsecurity: ['text'], listed: ['choice', ['No', 'Listed building', 'Conservation area', 'Article 4']],
  flatspd: ['choice', YESNO], sideobscure: ['choice', ['Obscure + non-opening below 1.7 m', 'Not applicable']], baynew: ['choice', ['Replacement', 'New bay']], cert: ['choice', ['FENSA', 'Certass', 'Building Control']],
  // product
  sbd: ['bool'], dogbolts: ['bool'], pas: ['bool'], doordog: ['bool'], dummystays: ['bool'], letterplate: ['bool'],
  glazed: ['choice', ['Glazed', 'Unglazed']], finish: ['choice', ['White', 'Foil']], foilcol: ['text'], foilside: ['choice', ['Both sides', 'On white']],
  bead: ['choice', ['28mm Sculptured', '36mm Sculptured', '28mm Chamfered', '40mm Chamfered']],
  outerframe: ['choice', ['50mm', '60mm', '70mm']], cill: ['choice', ['None', '85mm', '110mm', '150mm', '180mm', '225mm']], extcill: ['choice', ['None', '85mm', '110mm', '150mm', '180mm', '225mm']],
  addon: ['choice', ['15mm', '20mm', '35mm', '50mm']], addonside: ['multi', ['Top', 'Bottom', 'Left', 'Right']],
  tvsize: ['choice', ['2,500 EA', '4,000 EA', '5,000 EA', '8,000 EA (2×4,000)', '10,000 EA (2×5,000)']],
  tl: ['choice', ['Toughened', 'Laminated', 'Toughened + Laminated']], glass: ['text'], notes: ['text'], addetails: ['text'],
  width: ['number', null, 'mm'], height: ['number', null, 'mm'], pw: ['number', null, 'mm'], phin: ['number', null, 'mm'], phex: ['number', null, 'mm'],
  mullion: ['number', null, 'mm'], transom: ['number', null, 'mm'], midrail: ['number', null, 'mm'], polelength: ['number', null, 'mm'], poles: ['number'],
  reinforced: ['choice', YESNO], loadbearing: ['choice', YESNO], cilllayout: ['text'], panels: ['text'], limits: ['text'], panelfinish: ['text'], framecol: ['text'],
  furncol: ['choice', ['White', 'Black', 'Chrome', 'Satin', 'Gold', 'Rose Gold', 'Graphite', 'Anthracite Grey']],
  patiohandle: ['choice', ['White', 'Black', 'Chrome', 'Satin', 'Gold', 'Rose Gold', 'Graphite', 'Anthracite Grey']],
  extcillx: ['text'], patiomid: ['choice', ['No', 'Yes (115mm)']], patiolp: ['text'], patiotv: ['text'], bars: ['text'], doorglass: ['text'],
  shapedglazed: ['text'], optbead: ['text'], optfixed: ['text'], optnight: ['text'], monkey: ['text'], fmt: ['text'], dummysash: ['text'], patiospec: ['text'], erw: ['text'], spacer: ['text'],
  angletype: ['choice', ['Variable angle', 'Fixed 135°', 'Fixed 150°', 'Bow bay couplers (160–180°)']],
};
function kindOf(key, opt) {
  if (KIND[key]) { const [k, o, u] = KIND[key]; return { kind: k, options: o || undefined, unit: u || undefined }; }
  if (/^mm\b/.test(opt || '')) return { kind: 'number', unit: 'mm' };
  if (opt && / \/ /.test(opt) && opt.length < 120 && !/[.;:(]/.test(opt)) return { kind: 'choice', options: opt.split(' / ').map((s) => s.trim()) };
  return { kind: 'text' };
}
const parseSug = (s) => { const [l, w] = s.split(':'); return { levels: l.split(',').map(Number), who: (w || '').split(',').filter(Boolean) }; };

const fields = {}, header = [], regs = [], types = {}, undecided = [], skipped = [];
function entry(gid, key) {
  const id = gid + '.' + key; const d = dec[id]; const def = F[key];
  if (d && /skipped/i.test(d.note || '') && !(d.levels || []).length) { skipped.push(id); return null; }
  let levels, who, decided = true;
  if (d && (d.levels || []).length) { levels = d.levels.slice().sort(); who = (d.who || []).map((w) => WHO[w]).filter(Boolean); }
  else { const s = parseSug(def[2]); levels = s.levels; who = s.who.map((w) => WHO[w]); decided = false; undecided.push(id); }
  if (!who.length) who = ['office'];
  const note = d && d.note && !/skipped|to check/i.test(d.note) ? d.note : undefined;
  return { key, levels, who: [...new Set(who)], decided, default: note };
}
for (const g of GROUPS) for (const key of g.keys) {
  if (DROP.has(key) || !F[key]) continue;
  const e = entry(g.id, key); if (!e) continue;
  const def = F[key];
  if (!fields[key]) fields[key] = { label: def[0], hint: def[1] || undefined, reg: def[3] || undefined, ...kindOf(key, def[1]), column: COLUMN[key], merge: (key === 'notes' || key === 'addetails') ? 'concat' : undefined,
    section: g.id === 'hdr' ? 'header' : g.id === 'reg' ? 'regs' : 'form' };
  if (g.id === 'hdr') header.push(e); else if (g.id === 'reg') regs.push(e); else (types[TYPE_NAME[g.id]] ||= []).push(e);
}
const clean = (o) => JSON.parse(JSON.stringify(o));
const arr = (a) => '[\n' + a.map((e) => '  ' + JSON.stringify(e) + ',').join('\n') + '\n]';
const lines = (o, nested) => '{\n' + Object.entries(o).map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + (nested ? arr(v).replace(/\n/g, '\n  ') : JSON.stringify(v)) + ',').join('\n') + '\n}';
const ts = `// GENERATED from the Acemark Spec Matrix decisions (${new Date().toISOString().slice(0, 10)}) — edit the matrix and regenerate,
// or edit by hand with care. Levels: 1 Customer · 2 Job · 3 Elevation · 4 Flat · 5 Room type · 6 Item.
// "decided: false" = left blank in the matrix; the suggested level is used until someone decides.
import type { SpecFieldDef, SpecEntry } from './spec';

export const SPEC_FIELDS: Record<string, SpecFieldDef> = ${lines(clean(fields))};

/** PO header fields (customer / job level). */
export const SPEC_HEADER: SpecEntry[] = ${arr(clean(header))};

/** Building Regulations checks — apply to every item type. */
export const SPEC_REGS: SpecEntry[] = ${arr(clean(regs))};

/** Order-form fields per item type (one Emplas form each). */
export const SPEC_TYPE_FIELDS: Record<string, SpecEntry[]> = ${lines(clean(types), true)};
`;
fs.writeFileSync(process.argv[3], ts);
console.log('fields', Object.keys(fields).length, 'header', header.length, 'regs', regs.length, 'types', Object.entries(types).map(([k, v]) => k + ':' + v.length).join(', '));
console.log('skipped', skipped.length, skipped.join(' '));
console.log('undecided', undecided.length, undecided.join(' '));

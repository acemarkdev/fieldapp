// Install sign-off / QA — shared model. A flat is signed off with an internal QA checklist
// (pass/fail per line + note), snapshotted onto the record. Pure + deterministic so the office
// and (later) mobile agree, and the rollup can be unit-tested.

export interface QAChecklistItem { key: string; label: string }
export interface QAChecklistAnswer { key: string; label: string; ok: boolean; note?: string | null }
export type QAResult = 'pass' | 'fail';

// The default handover checklist for a window/door install. Tenants can edit their own copy
// (stored server-side); this is the fallback when none is set. Keep keys stable — answers are
// matched to lines by key when re-opening a saved sign-off.
export const QA_CHECKLIST_DEFAULT: QAChecklistItem[] = [
  { key: 'operate', label: 'All windows & doors open, close and lock correctly' },
  { key: 'glass', label: 'Glass undamaged and to correct spec (toughened where required)' },
  { key: 'vents', label: 'Trickle vents fitted and operating' },
  { key: 'seal', label: 'Sealant / silicone finished internally and externally' },
  { key: 'madegood', label: 'Reveals and plaster made good' },
  { key: 'hardware', label: 'Handles, hinges and hardware secure and adjusted' },
  { key: 'cills', label: 'Cills, trims and drainage correct' },
  { key: 'clean', label: 'Old frames removed, debris cleared, area left clean' },
];

// One flat's install progress, computed from its items. Snags are tracked separately from the
// install scope (a snag doesn't count as an outstanding install, but it's surfaced).
export interface FlatInstallRollup {
  flat: string;
  total: number;        // non-snag items in the flat (the install scope)
  installed: number;    // items marked installed (with or without snag)
  snags: number;        // open snags affecting the flat
  outstanding: number;  // install-scope items not yet installed
  ready: boolean;       // all install-scope items installed (ready to sign off)
}

const isInstalled = (s?: string | null) => s === 'installed_no_snag' || s === 'installed_snag';
const isSnag = (it: { kind?: string | null; install_status?: string | null }) =>
  (it.kind ?? 'item') === 'snag' || it.install_status === 'snag' || it.install_status === 'installed_snag';

export function rollupFlats(
  items: { flat?: string | null; kind?: string | null; install_status?: string | null }[],
): FlatInstallRollup[] {
  const groups: Record<string, { total: number; installed: number; snags: number }> = {};
  for (const it of items) {
    const flat = (it.flat ?? '').trim() || '(no flat)';
    const g = (groups[flat] = groups[flat] || { total: 0, installed: 0, snags: 0 });
    if (isSnag(it)) g.snags++;
    if ((it.kind ?? 'item') === 'snag') continue;   // snags aren't part of the install scope
    g.total++;
    if (isInstalled(it.install_status)) g.installed++;
  }
  return Object.keys(groups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((flat) => {
    const g = groups[flat];
    const outstanding = Math.max(0, g.total - g.installed);
    return { flat, total: g.total, installed: g.installed, snags: g.snags, outstanding, ready: g.total > 0 && outstanding === 0 };
  });
}

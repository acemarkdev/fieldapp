// Common glass / sealed-unit specs. `4-x-4` = 4mm pane, x mm cavity, 4mm pane.
// Hardcoded so it works offline; the "More…" list is searchable and also allows a
// free-typed custom spec. Edit this list to match ACE's standard options.
export const GLASS_DEFAULT = '4-20-4';

export const GLASS_QUICK = ['4-20-4', '4-16-4', '4-12-4'];

export const GLASS_OPTIONS = [
  '4-20-4',            // 28mm double-glazed unit (most common)
  '4-16-4',            // 24mm
  '4-12-4',            // 20mm
  '4-6-4',             // 14mm
  '4-20-4 Low-E',
  '4-16-4 Low-E',
  '4-20-4 Argon',
  '4-20-4 Toughened',
  '4-20-4 Laminated',
  '4-20-4 Obscure',
  '4-12-4-12-4',       // triple-glazed unit
  '4-16-4-16-4',       // triple-glazed unit
];

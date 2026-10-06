// The fitter's two-button status flow (Installed / Delayed) on the item screen.
// Pure (no React Native imports) so it is unit-testable.
export type FitterAction = 'installed' | 'delayed';
export interface StatusChange { install_status: string; actual_install_date?: string | null }

/** What tapping a button should save. An item that has a snag raised against it is
 *  "Installed + snag", never plain "Installed". Tapping the button that is already on undoes it
 *  (back to Scheduled, install date cleared). */
export function fitterTap(action: FitterAction, current: string | null, hasSnag: boolean, today: string): { change: StatusChange; undo: boolean } {
  const target = action === 'delayed' ? 'delayed' : (hasSnag ? 'installed_snag' : 'installed_no_snag');
  // The Installed button is lit for either installed status, so either one means "already on".
  const on = action === 'delayed' ? current === 'delayed' : (current === 'installed_no_snag' || current === 'installed_snag');
  if (on) return { undo: true, change: { install_status: 'scheduled', actual_install_date: null } };
  if (action === 'delayed') return { undo: false, change: { install_status: 'delayed', actual_install_date: null } };
  return { undo: false, change: { install_status: target, actual_install_date: today } };
}

/** Raising a snag against an item marks the item itself Installed + snag. The install date is kept
 *  if it already has one. */
export function afterSnagRaised(currentDate: string | null, today: string): StatusChange {
  return { install_status: 'installed_snag', actual_install_date: currentDate || today };
}

export const isInstalledStatus = (s: string | null | undefined) => s === 'installed_no_snag' || s === 'installed_snag';

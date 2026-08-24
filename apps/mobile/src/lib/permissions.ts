// Role capabilities — a self-contained mirror of packages/shared/src/permissions.ts.
// (The mobile app deliberately doesn't import @ace/shared, so keep this in step with it.)
// The database (RLS, migration 0007) is the real boundary; this only decides what the
// UI shows, so field staff don't see buttons that would be refused.

export type Role = 'admin' | 'office' | 'surveyor' | 'scanner' | 'fitter' | 'invoice_manager';

export type Capability =
  | 'jobs.manage' | 'items.create' | 'items.edit' | 'items.fit'
  | 'snags.raise' | 'photos.add';

const ROLE_CAPS: Record<Role, Capability[]> = {
  admin: ['jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'photos.add'],
  office: ['jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'photos.add'],
  surveyor: ['items.create', 'items.edit', 'snags.raise', 'photos.add'],
  scanner: ['items.create', 'photos.add'],
  fitter: ['items.fit', 'snags.raise', 'photos.add'],
  invoice_manager: [], // finance-only; no field capabilities on the phone
};

export function can(role: string | null | undefined, cap: Capability): boolean {
  if (role === 'admin') return true;
  return (ROLE_CAPS[(role as Role)] ?? []).includes(cap);
}

// Fitters only see items that are ready to fit (i.e. carry an install status).
export function isFitter(role: string | null | undefined): boolean {
  return role === 'fitter';
}

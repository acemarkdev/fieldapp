// Create (or update) a Supabase Auth login and link it to the matching app_users row.
// Uses the service-role admin API — server-side only. Run once via create-admin.ts.
import { db, anonClient } from './supabase';

export async function createOrLinkUser(email: string, password: string): Promise<{ id: string; created: boolean; linked: boolean }> {
  const admin = db().auth.admin;

  let userId: string | null = null;
  let created = false;

  const { data } = await admin.createUser({ email, password, email_confirm: true });
  if (data?.user) {
    userId = data.user.id;
    created = true;
  } else {
    // already exists — find it and reset the password to the provided one
    const list = await admin.listUsers();
    const found = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) throw new Error('Could not create or find the auth user');
    userId = found.id;
    await admin.updateUserById(userId, { password });
  }

  // link the app_users row (seeded by email) to this auth user
  const { data: appUser, error } = await db()
    .from('app_users').update({ auth_user_id: userId }).eq('email', email).select('id').maybeSingle();
  if (error) throw error;

  return { id: userId!, created, linked: !!appUser };
}

// Create an app_users row for this tenant (or reactivate an existing one), then create/link the login.
export async function inviteUser(
  tenantId: string, email: string, name: string, role: string, password: string,
): Promise<{ created: boolean; appUserId: string }> {
  const existing = await db().from('app_users').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle();
  let appUserId: string;
  if (existing.data) {
    appUserId = existing.data.id;
    await db().from('app_users').update({ name, role, active: true }).eq('id', appUserId);
  } else {
    const ins = await db().from('app_users').insert({ tenant_id: tenantId, email, name, role }).select('id').single();
    if (ins.error) throw ins.error;
    appUserId = ins.data.id;
  }
  const link = await createOrLinkUser(email, password); // creates the auth user + sets auth_user_id
  return { created: link.created, appUserId };
}

// Change a user's login email (admin API), so their Supabase login stays in sync with app_users.
export async function updateAuthEmail(authUserId: string, email: string): Promise<void> {
  await db().auth.admin.updateUserById(authUserId, { email, email_confirm: true });
}

// Find an auth user's id by email, paging through all users (listUsers only returns
// one page at a time, so a single call can miss the user once there are >50 of them).
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = db().auth.admin;
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('Could not list logins: ' + error.message);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (users.length < 200) break; // reached the last page
  }
  return null;
}

// Reset a user's login password (admin API). Throws unless the new password demonstrably works,
// so the caller never hands out a password that isn't actually live.
// `authUserId` (app_users.auth_user_id) is only trusted if that login has the same email — a stale
// link (e.g. a row copied from another Supabase project) would otherwise change the wrong login.
export async function resetUserPassword(appUserId: string, email: string, password: string, authUserId?: string | null): Promise<void> {
  const admin = db().auth.admin;
  const target = email.trim().toLowerCase();

  let userId = authUserId ?? null;
  if (userId) {
    try {
      const { data } = await admin.getUserById(userId);
      if ((data?.user?.email ?? '').toLowerCase() !== target) userId = null;
    } catch { userId = null; } // malformed / unknown id → treat as stale
  }
  if (!userId) userId = await findAuthUserIdByEmail(target);

  if (userId) {
    // email_confirm: an unconfirmed login can't sign in with a password at all.
    const { error } = await admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw new Error('Could not set the new password: ' + error.message);
  } else {
    // No auth login exists yet for this person — create one.
    const { data, error } = await admin.createUser({ email: target, password, email_confirm: true });
    if (error || !data?.user) throw new Error('Could not create a login: ' + (error?.message ?? 'unknown error'));
    userId = data.user.id;
  }

  if (userId !== authUserId) {
    const link = await db().from('app_users').update({ auth_user_id: userId }).eq('id', appUserId);
    if (link.error) throw new Error('Password set but linking the account failed: ' + link.error.message);
  }

  // Prove it: sign in with the new password exactly as the login screen will.
  const c = anonClient();
  const { data: s, error: e } = await c.auth.signInWithPassword({ email: target, password });
  if (e || !s?.session) throw new Error('Password was set, but a test sign-in failed: ' + (e?.message ?? 'no session'));
  await c.auth.signOut({ scope: 'local' }).catch(() => {}); // end only this test session, not the user's real ones
}

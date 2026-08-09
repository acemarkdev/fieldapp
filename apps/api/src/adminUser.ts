// Create (or update) a Supabase Auth login and link it to the matching app_users row.
// Uses the service-role admin API — server-side only. Run once via create-admin.ts.
import { db } from './supabase';

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

// Reset a user's login password (admin API). Returns nothing; caller shares the new password.
export async function resetUserPassword(email: string, password: string): Promise<void> {
  const admin = db().auth.admin;
  const list = await admin.listUsers();
  const found = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) { await admin.createUser({ email, password, email_confirm: true }); return; }
  await admin.updateUserById(found.id, { password });
}

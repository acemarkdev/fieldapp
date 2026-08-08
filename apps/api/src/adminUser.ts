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

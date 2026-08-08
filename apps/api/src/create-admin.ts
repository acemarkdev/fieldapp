// Create a login for the office web app (run once).
//
// Run:  node --env-file=.env --import tsx apps/api/src/create-admin.ts [email] [password]
//   defaults: milosz@acegroup-uk.com / ChangeMe123!
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.

import { createOrLinkUser } from './adminUser';

const email = process.argv[2] ?? 'milosz@acegroup-uk.com';
const password = process.argv[3] ?? 'ChangeMe123!';

const r = await createOrLinkUser(email, password);
console.log(`\n✓ Login ${r.created ? 'created' : 'updated'} for ${email}`);
console.log(`  linked to app_users: ${r.linked ? 'yes' : 'NO (no matching email in app_users)'}`);
console.log(`\n  Log in to the office app with:`);
console.log(`    email:    ${email}`);
console.log(`    password: ${password}\n`);

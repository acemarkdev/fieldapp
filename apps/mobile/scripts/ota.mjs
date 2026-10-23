// Over-the-air update of the phone app (JavaScript only — anything native needs a store build).
//   npm run update:prod -- "what changed"     → phones on the production channel (prod database)
//   npm run update:test -- "what changed"     → builds on the preview channel (test database)
// The database address and key are taken from the same eas.json build profile the store builds use,
// so an update can never point a production phone at the test database (the local .env is test).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const profile = process.argv[2], message = process.argv.slice(3).join(' ').trim();
if (!['production', 'preview'].includes(profile)) { console.error('Usage: node scripts/ota.mjs production|preview "message"'); process.exit(1); }
if (!message) { console.error('Say what changed: npm run update:prod -- "fix: …"'); process.exit(1); }
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url)));
const p = eas.build[profile];
const env = { ...process.env, ...p.env };
console.log(`Publishing to channel "${p.channel}" with ${p.env.EXPO_PUBLIC_SUPABASE_URL}`);
// --environment is required by eas-cli in non-interactive mode; the database address and key still come from
// eas.json above (process env), the EAS environment only adds variables set on expo.dev (none for this app).
// Windows: npx is npx.cmd and needs the shell (the message is quoted for it)
const WIN = process.platform === 'win32';
const r = WIN
  ? spawnSync('npx.cmd', ['eas-cli', 'update', '--channel', p.channel, '--environment', profile, '--message', JSON.stringify(message), '--non-interactive'], { stdio: 'inherit', env, shell: true })
  : spawnSync('npx', ['eas-cli', 'update', '--channel', p.channel, '--environment', profile, '--message', message, '--non-interactive'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);

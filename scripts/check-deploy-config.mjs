import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const envExamplePath = join(root, '.env.example');
if (existsSync(envExamplePath)) {
  failures.push('.env.example would expose duplicate Deploy Button secrets');
}

const devVarsExamplePath = join(root, '.dev.vars.example');
if (!existsSync(devVarsExamplePath)) {
  failures.push('.dev.vars.example must expose the initial administrator password');
} else {
  const secretExample = readFileSync(devVarsExamplePath, 'utf8');
  const secretNames = [...secretExample.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]);
  if (secretNames.length !== 1 || secretNames[0] !== 'INITIAL_ADMIN_PASSWORD') {
    failures.push('.dev.vars.example may expose only INITIAL_ADMIN_PASSWORD');
  }
  if (!/^\s*INITIAL_ADMIN_PASSWORD=mygateway123\s*$/m.test(secretExample)) {
    failures.push('.dev.vars.example must document the mygateway123 default');
  }
}

const wranglerConfig = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
if (!/^\s*"name"\s*:\s*"mygateway"\s*,?\s*$/m.test(wranglerConfig)) {
  failures.push('wrangler.jsonc must prefill the Worker name as mygateway');
}
if (!/^\s*"database_name"\s*:\s*"mygateway-db"\s*,?\s*$/m.test(wranglerConfig)) {
  failures.push('wrangler.jsonc must prefill the D1 resource name as mygateway-db');
}
if (/^\s*"vars"\s*:/m.test(wranglerConfig)) {
  failures.push('wrangler.jsonc exposes runtime defaults as Deploy Button variables');
}
if (/^\s*"env"\s*:/m.test(wranglerConfig)) {
  failures.push('wrangler.jsonc contains an environment block that can expose duplicate resources');
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (packageJson.cloudflare?.bindings?.MASTER_KEY) {
  failures.push('MASTER_KEY must remain internal and absent from Deploy Button metadata');
}
const passwordDescription = packageJson.cloudflare?.bindings?.INITIAL_ADMIN_PASSWORD?.description ?? '';
if (!passwordDescription.includes('mygateway123')) {
  failures.push('INITIAL_ADMIN_PASSWORD metadata must explain its default value');
}
const deployScript = packageJson.scripts?.deploy ?? '';
if (!deployScript.includes('db:migrate:remote') || !deployScript.includes('secrets:init')) {
  failures.push('deploy script must migrate D1 and initialize internal secrets');
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('Deploy Button configuration check passed (only the initial password is user-configurable).');

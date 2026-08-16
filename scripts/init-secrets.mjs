import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const initialAdminPassword = 'mygateway123';

function runWrangler(args, input) {
  const result = spawnSync(wrangler, ['wrangler', ...args], {
    encoding: 'utf8',
    input,
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  return result.stdout;
}
function listSecretNames() {
  const output = runWrangler(['secret', 'list', '--env', '']);
  const start = output.indexOf('[');
  if (start < 0) throw new Error('Unable to parse Wrangler secret list');
  return new Set(JSON.parse(output.slice(start)).map((entry) => entry.name));
}

function putSecret(name, value) {
  runWrangler(['secret', 'put', name, '--env', ''], `${value}\n`);
}

const existing = listSecretNames();
const generated = new Set();

if (!existing.has('MASTER_KEY')) {
  const value = randomBytes(32).toString('base64');
  putSecret('MASTER_KEY', value);
  generated.add('MASTER_KEY');
}

if (!existing.has('INITIAL_ADMIN_PASSWORD')) {
  putSecret('INITIAL_ADMIN_PASSWORD', initialAdminPassword);
  generated.add('INITIAL_ADMIN_PASSWORD');
}

if (generated.size === 0) {
  console.log('MyGateway secrets already exist; keeping the current values.');
} else {
  console.log(`Initialized Worker Secrets: ${[...generated].join(', ')}.`);
  if (generated.has('INITIAL_ADMIN_PASSWORD')) {
    console.log('Initial administrator: admin / mygateway123');
    console.log('Change these credentials after the first sign-in.');
  }
  console.log('MASTER_KEY is an internal encryption secret. Do not delete or rotate it.');
}

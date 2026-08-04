import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const workerName = process.env.MYGATEWAY_WORKER_NAME || 'mygatewaydemo';
const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';

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
  const output = runWrangler(['secret', 'list', '--name', workerName]);
  const start = output.indexOf('[');
  if (start < 0) throw new Error('Unable to parse Wrangler secret list');
  return new Set(JSON.parse(output.slice(start)).map((entry) => entry.name));
}

function putSecret(name, value) {
  runWrangler(['secret', 'put', name, '--name', workerName], `${value}\n`);
}

const existing = listSecretNames();
const generated = [];

if (!existing.has('MASTER_KEY')) {
  const value = randomBytes(32).toString('base64');
  putSecret('MASTER_KEY', value);
  generated.push(['MASTER_KEY', value]);
}

if (!existing.has('INITIAL_ADMIN_PASSWORD')) {
  const value = randomBytes(18).toString('base64url');
  putSecret('INITIAL_ADMIN_PASSWORD', value);
  generated.push(['INITIAL_ADMIN_PASSWORD', value]);
}

if (generated.length === 0) {
  console.log('MyGateway secrets already exist; keeping the current values.');
} else {
  console.log('\n============================================================');
  console.log(' MyGateway first-deploy credentials (shown only this time)');
  console.log('============================================================');
  console.log('INITIAL_ADMIN_USERNAME=admin');
  for (const [name, value] of generated) console.log(`${name}=${value}`);
  console.log('Save these values securely. Change the admin credentials after login.');
  console.log('Never regenerate MASTER_KEY after Provider keys have been stored.');
  console.log('============================================================\n');
}

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const MINIMUM_NODE_MAJOR = 22;
const DEFAULT_ADMIN_PASSWORD = 'mygateway123';

function envValue(contents, name) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match) return null;
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function setEnvValue(contents, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return `${contents.trimEnd()}${contents.trim() ? '\n' : ''}${line}\n`;
}

export function validateMasterKey(value) {
  if (!value) return false;
  try {
    return Buffer.from(value, 'base64').byteLength === 32;
  } catch {
    return false;
  }
}

export function ensureLocalSecrets(filePath) {
  const existed = existsSync(filePath);
  let contents = existed ? readFileSync(filePath, 'utf8') : '';
  let generatedMasterKey = false;

  const currentMasterKey = envValue(contents, 'MASTER_KEY');
  if (!currentMasterKey) {
    contents = setEnvValue(contents, 'MASTER_KEY', randomBytes(32).toString('base64'));
    generatedMasterKey = true;
  } else if (!validateMasterKey(currentMasterKey)) {
    throw new Error('MASTER_KEY in .dev.vars must be base64 that decodes to exactly 32 bytes.');
  }

  if (!envValue(contents, 'INITIAL_ADMIN_PASSWORD')) {
    contents = setEnvValue(contents, 'INITIAL_ADMIN_PASSWORD', DEFAULT_ADMIN_PASSWORD);
  }

  writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(filePath, 0o600); } catch {}

  return { created: !existed, generatedMasterKey };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function selectedPort(args) {
  const inline = args.find((arg) => arg.startsWith('--port='));
  if (inline) return inline.slice('--port='.length);
  const index = args.indexOf('--port');
  return index >= 0 && args[index + 1] ? args[index + 1] : '8787';
}

export function main(args = process.argv.slice(2)) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < MINIMUM_NODE_MAJOR) {
    throw new Error(`MyGateway requires Node.js ${MINIMUM_NODE_MAJOR} or later. Current: ${process.versions.node}`);
  }

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const wranglerBin = join(repositoryRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');

  console.log('\nMyGateway local setup');
  if (!existsSync(wranglerBin)) {
    console.log('Installing dependencies from package-lock.json...');
    run(npm, ['ci', '--no-audit', '--no-fund'], repositoryRoot);
  }

  const secrets = ensureLocalSecrets(join(repositoryRoot, '.dev.vars'));
  if (secrets.generatedMasterKey) console.log('Created the internal local encryption key.');

  console.log('Building the management console...');
  run(npm, ['run', 'build:dashboard'], repositoryRoot);
  console.log('Applying local database migrations...');
  run(npm, ['run', 'db:migrate:local'], repositoryRoot);

  const port = selectedPort(args);
  console.log(`\nOpen http://localhost:${port}`);
  if (secrets.created) {
    console.log(`Initial administrator: admin / ${DEFAULT_ADMIN_PASSWORD}`);
    console.log('Change these credentials after the first sign-in.');
  }
  console.log('Press Ctrl+C to stop MyGateway.\n');
  run(npm, ['run', 'dev', '--', ...args], repositoryRoot);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`MyGateway local setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

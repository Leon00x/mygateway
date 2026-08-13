import { spawnSync } from 'node:child_process';

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  executable,
  ['playwright', 'test', 'e2e/real-provider.spec.ts', ...process.argv.slice(2)],
  {
    env: { ...process.env, RUN_SIT: '1' },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

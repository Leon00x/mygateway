// @ts-nocheck -- this test covers the Node.js bootstrap script; Worker tests intentionally exclude Node types.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ensureLocalSecrets, validateMasterKey } from '../scripts/local.mjs';

const temporaryDirectories: string[] = [];

function temporaryFile() {
  const directory = mkdtempSync(join(tmpdir(), 'mygateway-local-'));
  temporaryDirectories.push(directory);
  return join(directory, '.dev.vars');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('local setup', () => {
  test('creates local secrets without exposing the generated master key through the result', () => {
    const file = temporaryFile();
    expect(ensureLocalSecrets(file)).toEqual({ created: true, generatedMasterKey: true });

    const contents = readFileSync(file, 'utf8');
    const masterKey = contents.match(/^MASTER_KEY=(.+)$/m)?.[1];
    expect(validateMasterKey(masterKey)).toBe(true);
    expect(contents).toContain('INITIAL_ADMIN_PASSWORD=mygateway123');
  });

  test('fills blank values and preserves existing local configuration', () => {
    const file = temporaryFile();
    writeFileSync(file, 'MASTER_KEY=\nDEEPSEEK_TEST_KEY=local-test-only\n');

    expect(ensureLocalSecrets(file)).toEqual({ created: false, generatedMasterKey: true });
    const contents = readFileSync(file, 'utf8');
    expect(contents).toContain('DEEPSEEK_TEST_KEY=local-test-only');
    expect(contents).toContain('INITIAL_ADMIN_PASSWORD=mygateway123');
  });

  test('keeps an existing master key and rejects invalid values', () => {
    const file = temporaryFile();
    const masterKey = Buffer.alloc(32, 7).toString('base64');
    writeFileSync(file, `MASTER_KEY=${masterKey}\nINITIAL_ADMIN_PASSWORD=changed-locally\n`);
    expect(ensureLocalSecrets(file)).toEqual({ created: false, generatedMasterKey: false });
    expect(readFileSync(file, 'utf8')).toContain(`MASTER_KEY=${masterKey}`);

    writeFileSync(file, 'MASTER_KEY=not-a-valid-key\n');
    expect(() => ensureLocalSecrets(file)).toThrow(/exactly 32 bytes/);
  });
});

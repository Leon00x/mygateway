import { describe, expect, test } from 'vitest';
import { hashPassword, validatePassword, validateUsername, verifyPassword } from '../src/auth/password.ts';

describe('administrator credentials', () => {
  test('hashes and verifies a password without storing plaintext', async () => {
    const digest = await hashPassword('a-strong-password');
    expect(digest.hash).not.toContain('a-strong-password');
    await expect(verifyPassword('a-strong-password', digest)).resolves.toBe(true);
    await expect(verifyPassword('the-wrong-password', digest)).resolves.toBe(false);
  });

  test('validates usernames and password length', () => {
    expect(validateUsername('admin')).toBeNull();
    expect(validateUsername('a')).toBeTruthy();
    expect(validateUsername('admin user')).toBeTruthy();
    expect(validatePassword('short')).toBeTruthy();
    expect(validatePassword('long-enough-password')).toBeNull();
  });
});

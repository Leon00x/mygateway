import { describe, expect, test } from 'vitest';
import { normalizePublicUrl } from '../src/admin/system.ts';

describe('public URL setting', () => {
  test.each([
    ['https://Gateway.Example.com/', 'https://gateway.example.com'],
    ['https://gateway.example.com:8443', 'https://gateway.example.com:8443'],
    ['http://localhost:8799/', 'http://localhost:8799'],
  ])('normalizes %s to its canonical origin', (input, expected) => {
    expect(normalizePublicUrl(input)).toBe(expected);
  });

  test.each([
    '',
    'javascript:alert(1)',
    'https://gateway.example.com/admin',
    'https://gateway.example.com?tenant=one',
    'https://gateway.example.com#settings',
    'https://admin:secret@gateway.example.com',
  ])('rejects a non-origin value: %s', (input) => {
    expect(() => normalizePublicUrl(input)).toThrow();
  });
});

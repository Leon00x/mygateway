import { describe, expect, test } from 'vitest';
import { fiveMinuteFloor, type AnalyticsDelta } from '../src/db/analytics.ts';
import { deriveContextKey, encryptContext, decryptContext } from '../src/crypto/context-encrypt.ts';
import { SseDecoder } from '../src/streaming/sse-decoder.ts';

describe('fiveMinuteFloor', () => {
  test('rounds down to nearest 5 minutes', () => {
    expect(fiveMinuteFloor(0)).toBe(0);
    expect(fiveMinuteFloor(299)).toBe(0);
    expect(fiveMinuteFloor(300)).toBe(300);
    expect(fiveMinuteFloor(301)).toBe(300);
    expect(fiveMinuteFloor(599)).toBe(300);
    expect(fiveMinuteFloor(600)).toBe(600);
  });

  test('handles real timestamps', () => {
    const ts = 1755023400; // some real timestamp
    const floor = fiveMinuteFloor(ts);
    expect(floor % 300).toBe(0);
    expect(floor <= ts).toBe(true);
    expect(ts - floor).toBeLessThan(300);
  });
});

describe('context encryption round-trip', () => {
  const fakeMasterKey = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='; // 32 bytes base64

  test('encrypt and decrypt short text', async () => {
    const key = await deriveContextKey(fakeMasterKey);
    const text = 'Hello, this is a test prompt!';
    const encrypted = await encryptContext(text, key, 'log-id-123');
    expect(encrypted).not.toBeNull();
    expect(encrypted!.iv).toBeTruthy();
    expect(encrypted!.tag).toBeTruthy();
    expect(encrypted!.ciphertext).toBeTruthy();

    const decrypted = await decryptContext(encrypted!, key, 'log-id-123');
    expect(decrypted).toBe(text);
  });

  test('decrypt with wrong AAD fails', async () => {
    const key = await deriveContextKey(fakeMasterKey);
    const text = 'secret content';
    const encrypted = await encryptContext(text, key, 'log-id-123');
    const decrypted = await decryptContext(encrypted!, key, 'wrong-id');
    expect(decrypted).toBeNull();
  });

  test('decrypt with different key fails', async () => {
    const key1 = await deriveContextKey(fakeMasterKey);
    const otherKey = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='; // different 32 bytes
    const key2 = await deriveContextKey(otherKey);
    const text = 'secret content';
    const encrypted = await encryptContext(text, key1, 'log-id-1');
    const decrypted = await decryptContext(encrypted!, key2, 'log-id-1');
    expect(decrypted).toBeNull();
  });

  test('truncates to 4 KiB', async () => {
    const key = await deriveContextKey(fakeMasterKey);
    const longText = 'A'.repeat(5000);
    const encrypted = await encryptContext(longText, key, 'test');
    expect(encrypted).not.toBeNull();
    const decrypted = await decryptContext(encrypted!, key, 'test');
    expect(decrypted!.length).toBeLessThanOrEqual(4100); // allow some extra due to utf8
    expect(decrypted!.length).toBeLessThan(5000);
  });

  test('null/empty text returns null', async () => {
    const key = await deriveContextKey(fakeMasterKey);
    expect(await encryptContext('', key, 'x')).toBeNull();
  });

  test('different MASTER_KEY produces different derived keys', async () => {
    const master1 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';
    const master2 = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';
    const key1 = await deriveContextKey(master1);
    const key2 = await deriveContextKey(master2);

    const text = 'test';
    const enc1 = await encryptContext(text, key1, 'id');
    const decBy2 = await decryptContext(enc1!, key2, 'id');
    expect(decBy2).toBeNull();
  });
});

describe('SseDecoder first-content detection (TTFT)', () => {
  function encodeSSE(data: string): Uint8Array {
    return new TextEncoder().encode(`data: ${data}\n\n`);
  }

  test('detects first content from OpenAI chat delta', () => {
    const decoder = new SseDecoder();
    expect(decoder.firstContentFound).toBe(false);
    // Empty delta — no content
    decoder.observe(encodeSSE('{"choices":[{"delta":{"content":""},"index":0}]}'));
    expect(decoder.firstContentFound).toBe(false);
    // Non-empty content
    decoder.observe(encodeSSE('{"choices":[{"delta":{"content":"Hello"},"index":0}]}'));
    expect(decoder.firstContentFound).toBe(true);
  });

  test('detects first content from OpenAI tool_calls delta', () => {
    const decoder = new SseDecoder();
    decoder.observe(encodeSSE('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather"}}]},"index":0}]}'));
    expect(decoder.firstContentFound).toBe(true);
  });

  test('detects first content from OpenAI responses delta', () => {
    const decoder = new SseDecoder();
    decoder.observe(encodeSSE('{"type":"response.output_text.delta","delta":"Hi there"}'));
    expect(decoder.firstContentFound).toBe(true);
  });

  test('detects first content from Anthropic content_block_delta', () => {
    const decoder = new SseDecoder();
    decoder.observe(encodeSSE('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello Claude"}}'));
    expect(decoder.firstContentFound).toBe(true);
  });

  test('detects content after cross-chunk SSE (partial then complete)', () => {
    const decoder = new SseDecoder();
    // First chunk: incomplete SSE — no newline yet
    decoder.observe(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"He'));
    expect(decoder.firstContentFound).toBe(false);
    // Second chunk: completes the event
    decoder.observe(new TextEncoder().encode('llo"},"index":0}]}\n\n'));
    expect(decoder.firstContentFound).toBe(true);
  });

  test('no false positive on metadata-only events', () => {
    const decoder = new SseDecoder();
    // Role announcement — no content
    decoder.observe(encodeSSE('{"choices":[{"delta":{"role":"assistant"},"index":0}]}'));
    expect(decoder.firstContentFound).toBe(false);
    // Usage chunk — no content
    decoder.observe(encodeSSE('{"usage":{"prompt_tokens":10,"completion_tokens":5}}'));
    expect(decoder.firstContentFound).toBe(false);
  });

  test('[DONE] marker does not trigger content', () => {
    const decoder = new SseDecoder();
    decoder.observe(new TextEncoder().encode('data: [DONE]\n\n'));
    expect(decoder.firstContentFound).toBe(false);
    expect(decoder.done).toBe(true);
  });
});

import { describe, expect, test } from 'vitest';
import { extractNonStreamUsage, SseDecoder } from '../src/streaming/sse-decoder.ts';
import { onceAsync } from '../src/streaming/once-async.ts';

const encoder = new TextEncoder();

function usageEvent(prompt = 12, completion = 5): string {
  return `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`;
}

describe('SSE usage decoder', () => {
  test('parses one event split across arbitrary network chunks', () => {
    const decoder = new SseDecoder();
    const bytes = encoder.encode(usageEvent() + 'data: [DONE]\n\n');

    for (const byte of bytes) decoder.observe(Uint8Array.of(byte));
    decoder.flush();

    expect(decoder.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(decoder.done).toBe(true);
    expect(decoder.parseError).toBe(false);
  });

  test('parses multiple events in one chunk and keeps the final usage', () => {
    const decoder = new SseDecoder();
    decoder.observe(encoder.encode(
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'
      + usageEvent(20, 3)
      + 'data: [DONE]\n\n',
    ));

    expect(decoder.usage).toEqual({ inputTokens: 20, outputTokens: 3 });
    expect(decoder.done).toBe(true);
  });

  test('handles a UTF-8 code point split between chunks', () => {
    const decoder = new SseDecoder();
    const bytes = encoder.encode('data: {"label":"中文","usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n');
    const splitAt = bytes.indexOf(0xe4) + 1;

    decoder.observe(bytes.slice(0, splitAt));
    decoder.observe(bytes.slice(splitAt));

    expect(decoder.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
    expect(decoder.parseError).toBe(false);
  });

  test('joins multi-line data fields into one JSON event', () => {
    const decoder = new SseDecoder();
    decoder.observe(encoder.encode(
      'event: completion\n'
      + 'data: {"usage":\n'
      + 'data: {"prompt_tokens":9,"completion_tokens":4}}\n\n',
    ));

    expect(decoder.usage).toEqual({ inputTokens: 9, outputTokens: 4 });
  });

  test('flushes a final usage event without a trailing blank line', () => {
    const decoder = new SseDecoder();
    decoder.observe(encoder.encode('data: {"usage":{"prompt_tokens":3,"completion_tokens":1}}'));
    decoder.flush();

    expect(decoder.usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  test('leaves usage unknown when the provider omits it', () => {
    const decoder = new SseDecoder();
    decoder.observe(encoder.encode('data: {"choices":[]}\n\ndata: [DONE]\n\n'));

    expect(decoder.usage).toBeNull();
    expect(decoder.done).toBe(true);
  });

  test('marks damaged JSON unknown without throwing', () => {
    const decoder = new SseDecoder();
    decoder.observe(encoder.encode('data: {not-json}\n\n'));

    expect(decoder.parseError).toBe(true);
    expect(decoder.usage).toBeNull();
  });

  test.each([
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1.5, completion_tokens: 1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: Number.POSITIVE_INFINITY },
  ])('rejects invalid token counts: $prompt_tokens / $completion_tokens', (usage) => {
    expect(extractNonStreamUsage({ usage })).toBeNull();
  });

  test('accepts zero and safe integer token counts', () => {
    expect(extractNonStreamUsage({
      usage: { prompt_tokens: 0, completion_tokens: Number.MAX_SAFE_INTEGER },
    })).toEqual({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER });
  });

  test('finalizes complete, error, or cancellation exactly once', async () => {
    const outcomes: string[] = [];
    const finalize = onceAsync(async (outcome: string) => {
      outcomes.push(outcome);
      return outcome;
    });

    const results = await Promise.all([
      finalize('success'),
      finalize('error'),
      finalize('cancelled'),
    ]);

    expect(outcomes).toEqual(['success']);
    expect(results).toEqual(['success', 'success', 'success']);
  });
});

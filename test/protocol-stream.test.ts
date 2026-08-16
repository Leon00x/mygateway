import { describe, expect, test } from 'vitest';
import { ProtocolSseTransformer } from '../src/gateway/protocol-stream.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function pushOneByteAtATime(transformer: ProtocolSseTransformer, input: string): string {
  const chunks: Uint8Array[] = [];
  for (const byte of encoder.encode(input)) chunks.push(...transformer.push(Uint8Array.of(byte)));
  chunks.push(...transformer.flush());
  return chunks.map((chunk) => decoder.decode(chunk)).join('');
}

describe('protocol SSE conversion', () => {
  test('converts arbitrarily split Chat text stream to Messages events', () => {
    const transformer = new ProtocolSseTransformer('openai_chat', 'anthropic_messages', 'public-model');
    const output = pushOneByteAtATime(transformer,
      'data: {"id":"chat_1","model":"provider-model","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'
      + 'data: {"id":"chat_1","model":"provider-model","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n'
      + 'data: {"id":"chat_1","model":"provider-model","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n'
      + 'data: [DONE]\n\n',
    );

    expect(output).toContain('event: message_start');
    expect(output).toContain('"type":"text_delta","text":"Hi"');
    expect(output).toContain('"stop_reason":"end_turn"');
    expect(output).toContain('"output_tokens":1');
    expect(output).toContain('event: message_stop');
  });

  test('converts Messages tool stream to Chat chunks and final usage', () => {
    const transformer = new ProtocolSseTransformer('anthropic_messages', 'openai_chat', 'public-model');
    const output = pushOneByteAtATime(transformer,
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
      + 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"weather","input":{}}}\n\n'
      + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Shanghai\\"}"}}\n\n'
      + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n'
      + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );

    expect(output).toContain('"name":"weather"');
    expect(output).toContain('"arguments":"{\\"city\\":\\"Shanghai\\"}"');
    expect(output).toContain('"finish_reason":"tool_calls"');
    expect(output).toContain('"prompt_tokens":5');
    expect(output).toContain('data: [DONE]');
  });
});

import { describe, expect, test } from 'vitest';
import {
  chatRequestToMessages,
  chatResponseToMessages,
  messagesRequestToChat,
  messagesResponseToChat,
  UnsupportedProtocolFeatureError,
} from '../src/gateway/protocol-conversion.ts';

describe('Chat and Messages protocol conversion', () => {
  test('converts Chat request system, tools and tool result to Messages', () => {
    const result = chatRequestToMessages({
      model: 'unified',
      max_tokens: 256,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1', type: 'function',
            function: { name: 'weather', arguments: '{"city":"Shanghai"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
      ],
      tools: [{
        type: 'function',
        function: { name: 'weather', description: 'Weather', parameters: { type: 'object' } },
      }],
      tool_choice: 'required',
    });

    expect(result.system).toBe('Be concise.');
    expect(result.tool_choice).toEqual({ type: 'any' });
    expect(result.tools).toEqual([{
      name: 'weather', description: 'Weather', input_schema: { type: 'object' },
    }]);
    expect(result.messages).toEqual([
      { role: 'user', content: 'Weather?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Shanghai' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' }] },
    ]);
  });

  test('converts Messages tool flow to Chat', () => {
    const result = messagesRequestToChat({
      model: 'unified',
      max_tokens: 128,
      system: [{ type: 'text', text: 'Use tools.' }],
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'weather', input: { city: 'Shanghai' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny' }] },
      ],
    });

    expect(result.messages).toEqual([
      { role: 'system', content: 'Use tools.' },
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant', content: null,
        tool_calls: [{
          id: 'toolu_1', type: 'function',
          function: { name: 'weather', arguments: '{"city":"Shanghai"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'sunny' },
    ]);
  });

  test('converts both non-stream response shapes and usage', () => {
    const messages = chatResponseToMessages({
      id: 'chat_1', model: 'provider-model',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: 'Checking',
          tool_calls: [{ id: 'call_1', function: { name: 'weather', arguments: '{}' } }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    expect(messages.stop_reason).toBe('tool_use');
    expect(messages.usage).toEqual({ input_tokens: 10, output_tokens: 4 });

    const chat = messagesResponseToChat({
      id: 'msg_1', model: 'provider-model', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 8, output_tokens: 2 },
    });
    expect(chat.choices).toEqual([expect.objectContaining({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Done' },
    })]);
    expect(chat.usage).toEqual({ prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 });
  });

  test('rejects unsupported fields instead of silently dropping them', () => {
    expect(() => chatRequestToMessages({
      model: 'unified', messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 16, response_format: { type: 'json_object' },
    })).toThrowError(UnsupportedProtocolFeatureError);

    expect(() => messagesRequestToChat({
      model: 'unified', max_tokens: 16, top_k: 20,
      messages: [{ role: 'user', content: 'Hi' }],
    })).toThrowError(/top_k/);
  });
});

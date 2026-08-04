import type { GatewayProtocol } from './protocols.ts';

type JsonObject = Record<string, unknown>;

export class UnsupportedProtocolFeatureError extends Error {
  constructor(readonly feature: string, message?: string) {
    super(message ?? `Protocol conversion does not support '${feature}'`);
    this.name = 'UnsupportedProtocolFeatureError';
  }
}

function object(value: unknown, feature: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnsupportedProtocolFeatureError(feature, `${feature} must be an object`);
  }
  return value as JsonObject;
}

function textContent(value: unknown, feature: string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw new UnsupportedProtocolFeatureError(feature);
  return value.map((part, index) => {
    const block = object(part, `${feature}[${index}]`);
    if (block.type !== 'text' || typeof block.text !== 'string') {
      throw new UnsupportedProtocolFeatureError(`${feature}[${index}].type`);
    }
    return block.text;
  }).join('');
}

function parseArguments(value: unknown, feature: string): JsonObject {
  if (typeof value !== 'string') throw new UnsupportedProtocolFeatureError(feature);
  try {
    return object(JSON.parse(value), feature);
  } catch {
    throw new UnsupportedProtocolFeatureError(feature, `${feature} must contain a JSON object`);
  }
}

function chatToolChoiceToMessages(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === 'auto') return { type: 'auto' };
  if (value === 'required') return { type: 'any' };
  const choice = object(value, 'tool_choice');
  if (choice.type === 'function') {
    const fn = object(choice.function, 'tool_choice.function');
    if (typeof fn.name === 'string') return { type: 'tool', name: fn.name };
  }
  throw new UnsupportedProtocolFeatureError('tool_choice');
}

function messagesToolChoiceToChat(value: unknown): unknown {
  if (value === undefined) return undefined;
  const choice = object(value, 'tool_choice');
  if (choice.type === 'auto') return 'auto';
  if (choice.type === 'any') return 'required';
  if (choice.type === 'tool' && typeof choice.name === 'string') {
    return { type: 'function', function: { name: choice.name } };
  }
  throw new UnsupportedProtocolFeatureError('tool_choice');
}

function assertNoUnsupported(body: JsonObject, allowed: Set<string>): void {
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key) && value !== undefined && value !== null) {
      throw new UnsupportedProtocolFeatureError(key);
    }
  }
}

export function chatRequestToMessages(body: JsonObject): JsonObject {
  assertNoUnsupported(body, new Set([
    'model', 'messages', 'max_tokens', 'max_completion_tokens', 'stream',
    'temperature', 'top_p', 'stop', 'tools', 'tool_choice',
  ]));
  const maxTokens = body.max_tokens ?? body.max_completion_tokens;
  if (!Number.isSafeInteger(maxTokens) || (maxTokens as number) <= 0) {
    throw new UnsupportedProtocolFeatureError(
      'max_tokens',
      'max_tokens is required when converting Chat Completions to Anthropic Messages',
    );
  }
  if (!Array.isArray(body.messages)) throw new UnsupportedProtocolFeatureError('messages');

  const system: string[] = [];
  const messages: JsonObject[] = [];
  for (let index = 0; index < body.messages.length; index++) {
    const message = object(body.messages[index], `messages[${index}]`);
    const role = message.role;
    if (role === 'system' || role === 'developer') {
      system.push(textContent(message.content, `messages[${index}].content`));
    } else if (role === 'user') {
      messages.push({ role: 'user', content: textContent(message.content, `messages[${index}].content`) });
    } else if (role === 'tool') {
      if (typeof message.tool_call_id !== 'string') {
        throw new UnsupportedProtocolFeatureError(`messages[${index}].tool_call_id`);
      }
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: textContent(message.content, `messages[${index}].content`),
        }],
      });
    } else if (role === 'assistant') {
      const content: JsonObject[] = [];
      const text = textContent(message.content ?? '', `messages[${index}].content`);
      if (text) content.push({ type: 'text', text });
      if (message.tool_calls !== undefined) {
        if (!Array.isArray(message.tool_calls)) {
          throw new UnsupportedProtocolFeatureError(`messages[${index}].tool_calls`);
        }
        for (let toolIndex = 0; toolIndex < message.tool_calls.length; toolIndex++) {
          const call = object(message.tool_calls[toolIndex], `messages[${index}].tool_calls[${toolIndex}]`);
          const fn = object(call.function, `messages[${index}].tool_calls[${toolIndex}].function`);
          if (typeof call.id !== 'string' || typeof fn.name !== 'string') {
            throw new UnsupportedProtocolFeatureError(`messages[${index}].tool_calls[${toolIndex}]`);
          }
          content.push({
            type: 'tool_use', id: call.id, name: fn.name,
            input: parseArguments(fn.arguments, `messages[${index}].tool_calls[${toolIndex}].function.arguments`),
          });
        }
      }
      messages.push({ role: 'assistant', content });
    } else {
      throw new UnsupportedProtocolFeatureError(`messages[${index}].role`);
    }
  }

  const result: JsonObject = { model: body.model, messages, max_tokens: maxTokens };
  if (system.length) result.system = system.join('\n\n');
  if (body.stream !== undefined) result.stream = body.stream;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop !== undefined) result.stop_sequences = typeof body.stop === 'string' ? [body.stop] : body.stop;
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new UnsupportedProtocolFeatureError('tools');
    result.tools = body.tools.map((tool, index) => {
      const item = object(tool, `tools[${index}]`);
      if (item.type !== 'function') throw new UnsupportedProtocolFeatureError(`tools[${index}].type`);
      const fn = object(item.function, `tools[${index}].function`);
      if (typeof fn.name !== 'string') throw new UnsupportedProtocolFeatureError(`tools[${index}].function.name`);
      return { name: fn.name, description: fn.description, input_schema: fn.parameters ?? { type: 'object' } };
    });
  }
  const toolChoice = chatToolChoiceToMessages(body.tool_choice);
  if (toolChoice !== undefined) result.tool_choice = toolChoice;
  return result;
}

export function messagesRequestToChat(body: JsonObject): JsonObject {
  assertNoUnsupported(body, new Set([
    'model', 'messages', 'max_tokens', 'stream', 'system', 'temperature',
    'top_p', 'stop_sequences', 'tools', 'tool_choice',
  ]));
  if (!Array.isArray(body.messages)) throw new UnsupportedProtocolFeatureError('messages');
  const messages: JsonObject[] = [];
  if (body.system !== undefined) {
    messages.push({ role: 'system', content: textContent(body.system, 'system') });
  }

  for (let index = 0; index < body.messages.length; index++) {
    const message = object(body.messages[index], `messages[${index}]`);
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new UnsupportedProtocolFeatureError(`messages[${index}].role`);
    }
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) throw new UnsupportedProtocolFeatureError(`messages[${index}].content`);

    if (message.role === 'user') {
      const blockTypes = message.content.map((part) => object(part, `messages[${index}].content`).type);
      const hasToolResults = blockTypes.some((type) => type === 'tool_result');
      if (hasToolResults && blockTypes.some((type) => type !== 'tool_result')) {
        throw new UnsupportedProtocolFeatureError(
          `messages[${index}].content`,
          'Mixed tool_result and user content cannot be represented safely in Chat Completions',
        );
      }
      if (hasToolResults) {
        for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
          const block = object(message.content[blockIndex], `messages[${index}].content[${blockIndex}]`);
          if (typeof block.tool_use_id !== 'string') {
            throw new UnsupportedProtocolFeatureError(`messages[${index}].content[${blockIndex}].tool_use_id`);
          }
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: textContent(block.content ?? '', `messages[${index}].content[${blockIndex}].content`),
          });
        }
      } else {
        messages.push({ role: 'user', content: textContent(message.content, `messages[${index}].content`) });
      }
    } else {
      const text: string[] = [];
      const toolCalls: JsonObject[] = [];
      for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
        const block = object(message.content[blockIndex], `messages[${index}].content[${blockIndex}]`);
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
        else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        } else throw new UnsupportedProtocolFeatureError(`messages[${index}].content[${blockIndex}].type`);
      }
      const translated: JsonObject = { role: 'assistant', content: text.join('') || null };
      if (toolCalls.length) translated.tool_calls = toolCalls;
      messages.push(translated);
    }
  }

  const result: JsonObject = { model: body.model, messages };
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.stream !== undefined) result.stream = body.stream;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop_sequences !== undefined) result.stop = body.stop_sequences;
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new UnsupportedProtocolFeatureError('tools');
    result.tools = body.tools.map((tool, index) => {
      const item = object(tool, `tools[${index}]`);
      if (typeof item.name !== 'string') throw new UnsupportedProtocolFeatureError(`tools[${index}].name`);
      return {
        type: 'function',
        function: { name: item.name, description: item.description, parameters: item.input_schema ?? { type: 'object' } },
      };
    });
  }
  const toolChoice = messagesToolChoiceToChat(body.tool_choice);
  if (toolChoice !== undefined) result.tool_choice = toolChoice;
  return result;
}

function chatFinishToMessages(reason: unknown): string | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  return reason == null ? null : String(reason);
}

function messagesFinishToChat(reason: unknown): string | null {
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'pause_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return reason == null ? null : String(reason);
}

export function chatResponseToMessages(body: JsonObject): JsonObject {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const choice = object(choices[0], 'choices[0]');
  const message = object(choice.message, 'choices[0].message');
  const content: JsonObject[] = [];
  if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  if (Array.isArray(message.tool_calls)) {
    for (let index = 0; index < message.tool_calls.length; index++) {
      const call = object(message.tool_calls[index], `choices[0].message.tool_calls[${index}]`);
      const fn = object(call.function, `choices[0].message.tool_calls[${index}].function`);
      content.push({
        type: 'tool_use', id: call.id, name: fn.name,
        input: parseArguments(fn.arguments, `choices[0].message.tool_calls[${index}].function.arguments`),
      });
    }
  }
  const usage = object(body.usage ?? {}, 'usage');
  return {
    id: body.id,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content,
    stop_reason: chatFinishToMessages(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

export function messagesResponseToChat(body: JsonObject): JsonObject {
  if (!Array.isArray(body.content)) throw new UnsupportedProtocolFeatureError('content');
  const text: string[] = [];
  const toolCalls: JsonObject[] = [];
  for (let index = 0; index < body.content.length; index++) {
    const block = object(body.content[index], `content[${index}]`);
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    } else throw new UnsupportedProtocolFeatureError(`content[${index}].type`);
  }
  const usage = object(body.usage ?? {}, 'usage');
  const message: JsonObject = { role: 'assistant', content: text.join('') || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: body.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message, finish_reason: messagesFinishToChat(body.stop_reason), logprobs: null }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0),
    },
  };
}

export function convertRequest(
  body: JsonObject,
  from: GatewayProtocol,
  to: GatewayProtocol,
): JsonObject {
  if (from === to) return structuredClone(body);
  if (from === 'openai_chat' && to === 'anthropic_messages') return chatRequestToMessages(body);
  if (from === 'anthropic_messages' && to === 'openai_chat') return messagesRequestToChat(body);
  throw new UnsupportedProtocolFeatureError(`${from}->${to}`, 'No protocol conversion path is configured');
}

export function convertResponse(
  body: JsonObject,
  from: GatewayProtocol,
  to: GatewayProtocol,
): JsonObject {
  if (from === to) return body;
  if (from === 'openai_chat' && to === 'anthropic_messages') return chatResponseToMessages(body);
  if (from === 'anthropic_messages' && to === 'openai_chat') return messagesResponseToChat(body);
  throw new UnsupportedProtocolFeatureError(`${from}->${to}`, 'No protocol conversion path is configured');
}

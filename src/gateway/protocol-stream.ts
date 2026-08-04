import type { GatewayProtocol } from './protocols.ts';
import { UnsupportedProtocolFeatureError } from './protocol-conversion.ts';

type JsonObject = Record<string, unknown>;
const encoder = new TextEncoder();

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function chatReasonToMessages(reason: unknown): string | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  return reason == null ? null : String(reason);
}

function messagesReasonToChat(reason: unknown): string | null {
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'pause_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return reason == null ? null : String(reason);
}

function anthropicEvent(event: string, data: JsonObject): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chatEvent(data: JsonObject): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** Incrementally converts complete SSE events without buffering generated content. */
export class ProtocolSseTransformer {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private dataLines: string[] = [];
  private eventName = '';
  private chatId = '';
  private model: string;
  private created = Math.floor(Date.now() / 1000);
  private messageStarted = false;
  private textBlock: number | null = null;
  private toolBlocks = new Map<number, number>();
  private nextBlock = 0;
  private finishReason: unknown = null;
  private promptTokens = 0;
  private completionTokens = 0;
  private completed = false;

  constructor(
    private readonly from: GatewayProtocol,
    private readonly to: GatewayProtocol,
    model: string,
  ) {
    this.model = model;
    if (!(
      (from === 'openai_chat' && to === 'anthropic_messages')
      || (from === 'anthropic_messages' && to === 'openai_chat')
    )) throw new UnsupportedProtocolFeatureError(`${from}->${to}`);
  }

  push(chunk: Uint8Array): Uint8Array[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  flush(): Uint8Array[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): Uint8Array[] {
    const output: Uint8Array[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      output.push(...this.line(line));
    }
    if (flush && this.buffer) {
      output.push(...this.line(this.buffer.replace(/\r$/, '')));
      this.buffer = '';
    }
    if (flush && this.dataLines.length) output.push(...this.event());
    if (flush && !this.completed) output.push(...this.finish());
    return output;
  }

  private line(line: string): Uint8Array[] {
    if (line === '') return this.event();
    if (line.startsWith('event:')) this.eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) this.dataLines.push(line.slice(5).trimStart());
    return [];
  }

  private event(): Uint8Array[] {
    if (!this.dataLines.length) {
      this.eventName = '';
      return [];
    }
    const raw = this.dataLines.join('\n');
    const eventName = this.eventName;
    this.dataLines = [];
    this.eventName = '';
    if (raw.trim() === '[DONE]') return this.finish();
    let data: JsonObject;
    try { data = asObject(JSON.parse(raw)); } catch { throw new Error('Invalid upstream SSE JSON'); }
    return this.from === 'openai_chat'
      ? this.chatToMessages(data)
      : this.messagesToChat(eventName || String(data.type ?? ''), data);
  }

  private ensureMessageStart(): Uint8Array[] {
    if (this.messageStarted) return [];
    this.messageStarted = true;
    return [anthropicEvent('message_start', {
      type: 'message_start',
      message: {
        id: this.chatId || `msg_${crypto.randomUUID()}`,
        type: 'message', role: 'assistant', model: this.model,
        content: [], stop_reason: null, stop_sequence: null,
        // Chat streaming only reports prompt usage at the end, so the start
        // event cannot contain an exact value without buffering the whole stream.
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })];
  }

  private chatToMessages(data: JsonObject): Uint8Array[] {
    const output: Uint8Array[] = [];
    if (typeof data.id === 'string') this.chatId = data.id;
    if (typeof data.model === 'string') this.model = data.model;
    if (typeof data.created === 'number') this.created = data.created;
    const usage = asObject(data.usage);
    if (typeof usage.prompt_tokens === 'number') this.promptTokens = usage.prompt_tokens;
    if (typeof usage.completion_tokens === 'number') this.completionTokens = usage.completion_tokens;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    if (!choices.length) return output;
    const choice = asObject(choices[0]);
    const delta = asObject(choice.delta);
    output.push(...this.ensureMessageStart());

    if (typeof delta.content === 'string' && delta.content) {
      if (this.textBlock === null) {
        this.textBlock = this.nextBlock++;
        output.push(anthropicEvent('content_block_start', {
          type: 'content_block_start', index: this.textBlock,
          content_block: { type: 'text', text: '' },
        }));
      }
      output.push(anthropicEvent('content_block_delta', {
        type: 'content_block_delta', index: this.textBlock,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const rawCall of delta.tool_calls) {
        const call = asObject(rawCall);
        const toolIndex = typeof call.index === 'number' ? call.index : 0;
        const fn = asObject(call.function);
        let blockIndex = this.toolBlocks.get(toolIndex);
        if (blockIndex === undefined) {
          blockIndex = this.nextBlock++;
          this.toolBlocks.set(toolIndex, blockIndex);
          output.push(anthropicEvent('content_block_start', {
            type: 'content_block_start', index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: typeof call.id === 'string' ? call.id : `toolu_${crypto.randomUUID()}`,
              name: typeof fn.name === 'string' ? fn.name : '', input: {},
            },
          }));
        }
        if (typeof fn.arguments === 'string' && fn.arguments) {
          output.push(anthropicEvent('content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: fn.arguments },
          }));
        }
      }
    }
    if (choice.finish_reason != null) this.finishReason = choice.finish_reason;
    return output;
  }

  private messagesToChat(eventName: string, data: JsonObject): Uint8Array[] {
    const output: Uint8Array[] = [];
    if (eventName === 'message_start') {
      const message = asObject(data.message);
      if (typeof message.id === 'string') this.chatId = message.id;
      if (typeof message.model === 'string') this.model = message.model;
      const usage = asObject(message.usage);
      if (typeof usage.input_tokens === 'number') this.promptTokens = usage.input_tokens;
      if (!this.messageStarted) {
        this.messageStarted = true;
        output.push(chatEvent({
          id: this.chatId, object: 'chat.completion.chunk', created: this.created, model: this.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }));
      }
    } else if (eventName === 'content_block_start') {
      const index = typeof data.index === 'number' ? data.index : 0;
      const block = asObject(data.content_block);
      if (block.type === 'tool_use') {
        output.push(chatEvent({
          id: this.chatId, object: 'chat.completion.chunk', created: this.created, model: this.model,
          choices: [{ index: 0, delta: { tool_calls: [{
            index, id: block.id, type: 'function', function: { name: block.name, arguments: '' },
          }] }, finish_reason: null }],
        }));
      } else if (block.type !== 'text') {
        throw new UnsupportedProtocolFeatureError(`stream.content_block.${String(block.type)}`);
      }
    } else if (eventName === 'content_block_delta') {
      const index = typeof data.index === 'number' ? data.index : 0;
      const delta = asObject(data.delta);
      if (delta.type === 'text_delta') {
        output.push(chatEvent({
          id: this.chatId, object: 'chat.completion.chunk', created: this.created, model: this.model,
          choices: [{ index: 0, delta: { content: delta.text ?? '' }, finish_reason: null }],
        }));
      } else if (delta.type === 'input_json_delta') {
        output.push(chatEvent({
          id: this.chatId, object: 'chat.completion.chunk', created: this.created, model: this.model,
          choices: [{ index: 0, delta: { tool_calls: [{
            index, function: { arguments: delta.partial_json ?? '' },
          }] }, finish_reason: null }],
        }));
      } else throw new UnsupportedProtocolFeatureError(`stream.delta.${String(delta.type)}`);
    } else if (eventName === 'message_delta') {
      const delta = asObject(data.delta);
      this.finishReason = messagesReasonToChat(delta.stop_reason);
      const usage = asObject(data.usage);
      if (typeof usage.output_tokens === 'number') this.completionTokens = usage.output_tokens;
    } else if (eventName === 'message_stop') {
      output.push(...this.finish());
    } else if (eventName === 'error') {
      throw new Error(String(asObject(data.error).message ?? 'Upstream stream error'));
    }
    return output;
  }

  private finish(): Uint8Array[] {
    if (this.completed) return [];
    this.completed = true;
    if (this.to === 'anthropic_messages') {
      const output = this.ensureMessageStart();
      const blocks = [this.textBlock, ...this.toolBlocks.values()]
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      for (const index of blocks) output.push(anthropicEvent('content_block_stop', { type: 'content_block_stop', index }));
      output.push(anthropicEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: chatReasonToMessages(this.finishReason), stop_sequence: null },
        usage: { output_tokens: this.completionTokens },
      }));
      output.push(anthropicEvent('message_stop', { type: 'message_stop' }));
      return output;
    }
    return [
      chatEvent({
        id: this.chatId, object: 'chat.completion.chunk', created: this.created, model: this.model,
        choices: [{ index: 0, delta: {}, finish_reason: this.finishReason }],
        usage: {
          prompt_tokens: this.promptTokens,
          completion_tokens: this.completionTokens,
          total_tokens: this.promptTokens + this.completionTokens,
        },
      }),
      encoder.encode('data: [DONE]\n\n'),
    ];
  }
}

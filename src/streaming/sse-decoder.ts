/**
 * SSE incremental decoder — parses SSE events across arbitrary network chunks.
 * Observes bytes for usage extraction without modifying the forwarded stream.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt cache-hit tokens (DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens). */
  cacheTokens?: number;
}

export class SseDecoder {
  private textDecoder = new TextDecoder();
  private buffer = '';
  private currentData: string[] = [];
  private lastUsage: Usage | null = null;
  private _done = false;
  private _parseError = false;
  private _firstContentFound = false;

  get done(): boolean {
    return this._done;
  }

  get parseError(): boolean {
    return this._parseError;
  }

  get usage(): Usage | null {
    return this.lastUsage;
  }

  /** True once the decoder observes at least one content-bearing SSE event. */
  get firstContentFound(): boolean {
    return this._firstContentFound;
  }

  /**
   * Observe a chunk of bytes. Does NOT modify the bytes.
   * Parses SSE event boundaries and extracts usage from the final chunk.
   */
  observe(chunk: Uint8Array): void {
    if (this._parseError) return;

    const text = this.textDecoder.decode(chunk, { stream: true });
    this.buffer += text;

    // Process complete lines
    let lineEnd: number;
    while ((lineEnd = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, '');
      this.buffer = this.buffer.slice(lineEnd + 1);
      this.processLine(line);
    }
  }

  /**
   * Flush any remaining buffered data.
   */
  flush(): void {
    if (this._parseError) return;

    this.buffer += this.textDecoder.decode();
    if (this.buffer.length > 0) {
      const remaining = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      this.processLine(remaining);
    }
    // Some compatible providers omit the final blank SSE event separator.
    if (this.currentData.length > 0) {
      this.processEvent(this.currentData.join('\n'));
      this.currentData = [];
    }
  }

  private processLine(line: string): void {
    // Empty line = event boundary
    if (line === '') {
      if (this.currentData.length > 0) {
        this.processEvent(this.currentData.join('\n'));
        this.currentData = [];
      }
      return;
    }

    // data: line
    if (line.startsWith('data: ')) {
      this.currentData.push(line.slice(6));
    } else if (line.startsWith('data:')) {
      this.currentData.push(line.slice(5));
    }
    // Ignore event:, id:, retry: lines for MVP
  }

  /** Check whether a parsed SSE event contains client-visible content. */
  private eventHasContent(obj: Record<string, unknown>): boolean {
    // OpenAI Chat: choices[].delta.content or choices[].delta.tool_calls
    const choices = obj.choices;
    if (Array.isArray(choices)) {
      for (const c of choices) {
        if (c && typeof c === 'object') {
          const delta = (c as Record<string, unknown>).delta;
          if (delta && typeof delta === 'object') {
            const d = delta as Record<string, unknown>;
            if (typeof d.content === 'string' && d.content.length > 0) return true;
            if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return true;
          }
        }
      }
    }
    // OpenAI Responses: type === 'response.output_text.delta' with non-empty delta
    if (typeof obj.type === 'string' && obj.type === 'response.output_text.delta') {
      if (typeof obj.delta === 'string' && obj.delta.length > 0) return true;
    }
    // Anthropic Messages: content_block_delta with text_delta
    if (typeof obj.type === 'string' && obj.type === 'content_block_delta') {
      const delta = obj.delta;
      if (delta && typeof delta === 'object') {
        const d = delta as Record<string, unknown>;
        if (d.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) return true;
        if (d.type === 'input_json_delta' && typeof d.partial_json === 'string' && d.partial_json.length > 0) return true;
      }
    }
    // Anthropic: content_block_start with text
    if (typeof obj.type === 'string' && obj.type === 'content_block_start') {
      const block = obj.content_block;
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) return true;
        if (b.type === 'tool_use') return true;
      }
    }
    // OpenAI Responses: response.output_item.added for tool calls
    if (typeof obj.type === 'string' && obj.type === 'response.output_item.added') {
      return true;
    }
    return false;
  }

  private processEvent(data: string): void {
    if (data.trim() === '[DONE]') {
      this._done = true;
      return;
    }

    // Try to parse as JSON, extract usage, and check for first content
    try {
      const obj = JSON.parse(data);
      if (!this._firstContentFound && this.eventHasContent(obj)) {
        this._firstContentFound = true;
      }
      if (obj.usage && typeof obj.usage === 'object') {
        const prompt = obj.usage.prompt_tokens ?? obj.usage.input_tokens;
        const completion = obj.usage.completion_tokens ?? obj.usage.output_tokens;
        if (isTokenCount(prompt) && isTokenCount(completion)) {
          this.lastUsage = { inputTokens: prompt, outputTokens: completion, cacheTokens: readCacheTokens(obj.usage as Record<string, unknown>) };
        } else if (isTokenCount(completion) && this.lastUsage) {
          this.lastUsage = { ...this.lastUsage, outputTokens: completion };
        }
      }
      const responseUsage = obj.response?.usage;
      if (responseUsage && typeof responseUsage === 'object') {
        const prompt = responseUsage.input_tokens;
        const completion = responseUsage.output_tokens;
        if (isTokenCount(prompt) && isTokenCount(completion)) {
          this.lastUsage = { inputTokens: prompt, outputTokens: completion, cacheTokens: readCacheTokens(responseUsage as Record<string, unknown>) };
        }
      }
      const messageUsage = obj.message?.usage;
      if (messageUsage && typeof messageUsage === 'object') {
        const prompt = messageUsage.input_tokens;
        const completion = messageUsage.output_tokens;
        if (isTokenCount(prompt) && isTokenCount(completion)) {
          this.lastUsage = { inputTokens: prompt, outputTokens: completion, cacheTokens: readCacheTokens(messageUsage as Record<string, unknown>) };
        }
      }
    } catch {
      // JSON parse failure — mark as parse error but continue
      this._parseError = true;
    }
  }
}

/**
 * Extract usage from a non-streaming Chat Completions response body.
 */
export function extractNonStreamUsage(body: unknown): Usage | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;
  const usage = obj.usage;
  if (!usage || typeof usage !== 'object') return null;

  const u = usage as Record<string, unknown>;
  const prompt = u.prompt_tokens ?? u.input_tokens;
  const completion = u.completion_tokens ?? u.output_tokens;

  if (isTokenCount(prompt) && isTokenCount(completion)) {
    return { inputTokens: prompt, outputTokens: completion, cacheTokens: readCacheTokens(u) };
  }

  return null;
}

/** Prompt cache-hit tokens from common usage shapes. */
function readCacheTokens(u: Record<string, unknown>): number | undefined {
  const details = u.prompt_tokens_details;
  if (details && typeof details === 'object') {
    const cached = (details as Record<string, unknown>).cached_tokens;
    if (isTokenCount(cached)) return cached;
  }
  if (isTokenCount(u.prompt_cache_hit_tokens)) return u.prompt_cache_hit_tokens;
  if (isTokenCount(u.cached_tokens)) return u.cached_tokens;
  return undefined;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

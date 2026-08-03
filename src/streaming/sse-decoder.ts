/**
 * SSE incremental decoder — parses SSE events across arbitrary network chunks.
 * Observes bytes for usage extraction without modifying the forwarded stream.
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export class SseDecoder {
  private textDecoder = new TextDecoder();
  private buffer = '';
  private currentData: string[] = [];
  private lastUsage: Usage | null = null;
  private _done = false;
  private _parseError = false;

  get done(): boolean {
    return this._done;
  }

  get parseError(): boolean {
    return this._parseError;
  }

  get usage(): Usage | null {
    return this.lastUsage;
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
    if (this.buffer.length > 0) {
      const remaining = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      this.processLine(remaining);
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

  private processEvent(data: string): void {
    if (data.trim() === '[DONE]') {
      this._done = true;
      return;
    }

    // Try to parse as JSON and extract usage
    try {
      const obj = JSON.parse(data);
      if (obj.usage && typeof obj.usage === 'object') {
        const prompt = obj.usage.prompt_tokens;
        const completion = obj.usage.completion_tokens;
        if (typeof prompt === 'number' && prompt >= 0 &&
            typeof completion === 'number' && completion >= 0) {
          this.lastUsage = { inputTokens: prompt, outputTokens: completion };
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
  const prompt = u.prompt_tokens;
  const completion = u.completion_tokens;

  if (typeof prompt === 'number' && prompt >= 0 &&
      typeof completion === 'number' && completion >= 0) {
    return { inputTokens: prompt, outputTokens: completion };
  }

  return null;
}

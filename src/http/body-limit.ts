/**
 * Request body size limit.
 */
import { gatewayErrorResponse } from './errors.ts';

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds size limit');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Read request body with size enforcement.
 * Returns null if body is absent.
 */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
  requestId: string,
): Promise<string | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new BodyTooLargeError();
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

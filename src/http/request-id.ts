/**
 * Gateway Request ID generation.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Shared ID generation utilities.
 */

/** Generate a new UUID v4. */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Generate a Gateway API Key: gw_<32 bytes base64url>. */
export function generateGatewayKeyValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'gw_' + base64url(bytes);
}

/** Generate a Management Key: mgmt_<32 bytes base64url>. */
export function generateManagementKeyValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'mgmt_' + base64url(bytes);
}

/** SHA-256 hash, returned as hex string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return hex(new Uint8Array(hash));
}

/** Base64url encoding (no padding). */
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Hex encoding. */
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Current Unix seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Current minute truncated to Unix seconds. */
export function nowMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60;
}

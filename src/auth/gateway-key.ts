/**
 * Gateway API Key authentication.
 * Keys are stored as SHA-256 hash in D1.
 * Format: gw_<base64url random bytes>
 */

import { sha256Hex } from '../shared/ids.ts';

/**
 * Extract Gateway Bearer Key from Authorization header.
 * Returns the raw key string, or null if missing/malformed.
 */
export function extractGatewayKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (!auth) return null;

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  const key = parts[1];
  if (!key.startsWith('gw_')) return null;

  return key;
}

/**
 * Hash a Gateway Key for storage lookup.
 */
export async function hashGatewayKey(key: string): Promise<string> {
  return sha256Hex(key);
}

/**
 * Get the display prefix of a Gateway Key (first 8 chars after gw_).
 */
export function gatewayKeyPrefix(key: string): string {
  // "gw_" + at least a few chars
  return key.slice(0, 11); // "gw_" + 8 chars
}

/**
 * Validate Gateway Key format.
 */
export function isValidGatewayKeyFormat(key: string): boolean {
  if (!key.startsWith('gw_')) return false;
  const payload = key.slice(3);
  // base64url: A-Z, a-z, 0-9, -, _
  return /^[A-Za-z0-9_-]+$/.test(payload) && payload.length >= 32;
}

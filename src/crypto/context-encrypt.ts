/**
 * Context encryption for request/response previews.
 *
 * Uses AES-GCM with a key derived from MASTER_KEY via HKDF with a
 * purpose-specific info string. The log entry ID is used as AAD to
 * bind ciphertext to a specific row.
 *
 * Only enabled when log_context setting is true and explicitly confirmed.
 * Maximum 4 KiB of UTF-8 text per request and per response.
 */

const CONTEXT_INFO_PREFIX = 'mygateway:analytics:context:v1';
const CONTEXT_MAX_BYTES = 4096; // 4 KiB per direction

export interface ContextEncryptionKey {
  deriveFrom(masterKey: string): Promise<CryptoKey>;
}

/** Derive a purpose-isolated AES-GCM key from the MASTER_KEY. */
export async function deriveContextKey(masterKey: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(masterKey), (c) => c.charCodeAt(0));
  const baseKey = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(CONTEXT_INFO_PREFIX) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedContext {
  iv: string;       // base64url IV
  tag: string;      // base64url auth tag (extracted for column storage)
  ciphertext: string; // base64url ciphertext
}

/**
 * Encrypt context text for storage.
 * Truncates to CONTEXT_MAX_BYTES before encryption.
 * Returns null if text is empty.
 */
export async function encryptContext(
  text: string,
  key: CryptoKey,
  aad: string,
): Promise<EncryptedContext | null> {
  if (!text || text.length === 0) return null;

  // Truncate to max bytes (safe UTF-8 truncation)
  let truncated = text;
  if (new TextEncoder().encode(text).length > CONTEXT_MAX_BYTES) {
    // Simple truncation at code point level that stays under byte limit
    let bytes = 0;
    let i = 0;
    for (const char of text) {
      const charBytes = new TextEncoder().encode(char).length;
      if (bytes + charBytes > CONTEXT_MAX_BYTES) break;
      bytes += charBytes;
      i++;
    }
    truncated = text.slice(0, i);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(truncated);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    encoded,
  );

  // GCM output is ciphertext || tag (last 16 bytes)
  const sealed = new Uint8Array(encrypted);
  const tag = sealed.slice(sealed.length - 16);
  const ciphertext = sealed.slice(0, sealed.length - 16);

  return {
    iv: base64url(iv),
    tag: base64url(tag),
    ciphertext: base64url(ciphertext),
  };
}

/**
 * Decrypt context text for display.
 */
export async function decryptContext(
  encrypted: { iv: string; tag: string; ciphertext: string },
  key: CryptoKey,
  aad: string,
): Promise<string | null> {
  try {
    const iv = base64urlDecode(encrypted.iv);
    const tag = base64urlDecode(encrypted.tag);
    const ciphertext = base64urlDecode(encrypted.ciphertext);
    const sealed = new Uint8Array(ciphertext.length + tag.length);
    sealed.set(ciphertext);
    sealed.set(tag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
      key,
      sealed,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null; // decryption failure (wrong key, tampered, etc.)
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  let base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

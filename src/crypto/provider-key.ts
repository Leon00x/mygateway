/**
 * Provider API Key encryption using AES-256-GCM.
 * MASTER_KEY is 32 bytes, base64-encoded in Worker Secrets.
 */

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12; // 12 bytes for GCM

/**
 * Derive a CryptoKey from the raw 32-byte master key material.
 */
async function importMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a Provider API Key.
 * Returns { ciphertext, iv } as base64 strings.
 */
export async function encryptProviderKey(
  plaintext: string,
  masterKeyBase64: string,
  channelId: string,
  keyVersion: number = 1,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);

  const aad = new TextEncoder().encode(`channel:${channelId}:v${keyVersion}`);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: aad },
    key,
    plaintextBytes,
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt a Provider API Key.
 */
export async function decryptProviderKey(
  ciphertext: string,
  iv: string,
  masterKeyBase64: string,
  channelId: string,
  keyVersion: number = 1,
): Promise<string> {
  const key = await importMasterKey(masterKeyBase64);
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ciphertextBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const aad = new TextEncoder().encode(`channel:${channelId}:v${keyVersion}`);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBytes, additionalData: aad },
    key,
    ciphertextBytes,
  );

  return new TextDecoder().decode(decrypted);
}

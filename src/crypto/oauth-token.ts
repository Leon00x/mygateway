/** AES-GCM protection for experimental OAuth credentials. */

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;

async function importMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
}

function bytesToBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function encryptOAuthSecret(
  plaintext: string,
  masterKeyBase64: string,
  recordId: string,
  purpose: string,
  version = 1,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const additionalData = new TextEncoder().encode(`oauth:${recordId}:${purpose}:v${version}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

export async function decryptOAuthSecret(
  ciphertext: string,
  iv: string,
  masterKeyBase64: string,
  recordId: string,
  purpose: string,
  version = 1,
): Promise<string> {
  const key = await importMasterKey(masterKeyBase64);
  const plaintext = await crypto.subtle.decrypt({
    name: ALGORITHM,
    iv: base64ToBytes(iv),
    additionalData: new TextEncoder().encode(`oauth:${recordId}:${purpose}:v${version}`),
  }, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(plaintext);
}

/**
 * Admin Session Cookie: HMAC-SHA-256 signed, HttpOnly, Secure, SameSite=Strict.
 *
 * Key is derived from ADMIN_TOKEN via HKDF.
 * Session payload: { version, issued_at, expires_at, nonce }.
 */

const COOKIE_NAME = 'mg_admin_session';
const SESSION_MAX_AGE_SECONDS = 8 * 3600; // 8 hours
const HKDF_INFO = 'mygateway-admin-session-hmac';

interface SessionPayload {
  version: number;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

/**
 * Derive an HMAC-SHA-256 signing key from ADMIN_TOKEN using HKDF.
 */
async function deriveHmacKey(adminToken: string): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(adminToken);
  const baseKey = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('mygateway-session-salt'),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    baseKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a session payload and return the cookie value.
 */
async function signSession(payload: SessionPayload, hmacKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', hmacKey, data);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const payloadB64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a cookie value and return the payload if valid.
 */
async function verifyCookieValue(
  cookieValue: string,
  hmacKey: CryptoKey,
): Promise<SessionPayload | null> {
  const dot = cookieValue.indexOf('.');
  if (dot === -1) return null;

  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  try {
    const payloadJson = atob(payloadB64);
    const payload: SessionPayload = JSON.parse(payloadJson);

    // Verify HMAC
    const data = new TextEncoder().encode(payloadJson);
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', hmacKey, sigBytes, data);
    if (!valid) return null;

    // Check expiry
    if (payload.expires_at < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a new admin session and return Set-Cookie header value.
 */
export async function createAdminSession(adminToken: string): Promise<string> {
  const hmacKey = await deriveHmacKey(adminToken);
  const now = Math.floor(Date.now() / 1000);
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const payload: SessionPayload = {
    version: 1,
    issued_at: now,
    expires_at: now + SESSION_MAX_AGE_SECONDS,
    nonce,
  };

  const value = await signSession(payload, hmacKey);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

/**
 * Validate an admin session from the request cookies.
 * Returns true if valid, false otherwise.
 */
export async function validateAdminSession(
  request: Request,
  adminToken: string,
): Promise<boolean> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const prefix = `${COOKIE_NAME}=`;
  const cookiePart = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(prefix));
  if (!cookiePart) return false;

  const value = cookiePart.slice(prefix.length);
  const hmacKey = await deriveHmacKey(adminToken);
  const payload = await verifyCookieValue(value, hmacKey);
  return payload !== null;
}

/**
 * Return a Set-Cookie header that clears the session cookie.
 */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME };

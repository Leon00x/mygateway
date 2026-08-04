/** Signed administrator session cookie with D1-backed invalidation. */

import { getAdminById } from '../db/admin-users.ts';

const COOKIE_NAME = 'mg_admin_session';
const SESSION_MAX_AGE_SECONDS = 8 * 3600;
const HKDF_INFO = 'mygateway-admin-session-hmac-v2';

export interface AdminSession {
  userId: string;
  username: string;
  mustChangePassword: boolean;
  sessionVersion: number;
}

interface SessionPayload {
  version: 2;
  user_id: string;
  username: string;
  session_version: number;
  must_change_password: boolean;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function deriveHmacKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (char) => char.charCodeAt(0));
  const baseKey = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('mygateway-session-salt-v2'),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    baseKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

async function signSession(payload: SessionPayload, key: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return `${encodeBase64Url(data)}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verifyCookieValue(value: string, key: CryptoKey): Promise<SessionPayload | null> {
  const separator = value.indexOf('.');
  if (separator < 1) return null;
  try {
    const data = decodeBase64Url(value.slice(0, separator));
    const signature = decodeBase64Url(value.slice(separator + 1));
    const valid = await crypto.subtle.verify('HMAC', key, signature, data);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(data)) as SessionPayload;
    if (payload.version !== 2 || payload.expires_at < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createAdminSession(
  masterKey: string,
  user: { id: string; username: string; must_change_password: 0 | 1; session_version: number },
  secure: boolean,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload: SessionPayload = {
    version: 2,
    user_id: user.id,
    username: user.username,
    session_version: user.session_version,
    must_change_password: user.must_change_password === 1,
    issued_at: now,
    expires_at: now + SESSION_MAX_AGE_SECONDS,
    nonce,
  };
  const value = await signSession(payload, await deriveHmacKey(masterKey));
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

export async function validateAdminSession(
  request: Request,
  db: D1Database,
  masterKey: string,
): Promise<AdminSession | null> {
  const cookie = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const payload = await verifyCookieValue(cookie.slice(COOKIE_NAME.length + 1), await deriveHmacKey(masterKey));
  if (!payload) return null;
  const user = await getAdminById(db, payload.user_id);
  if (!user || user.session_version !== payload.session_version) return null;
  return {
    userId: user.id,
    username: user.username,
    mustChangePassword: user.must_change_password === 1,
    sessionVersion: user.session_version,
  };
}

export function clearSessionCookie(secure = false): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export { COOKIE_NAME };

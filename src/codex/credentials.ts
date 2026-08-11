import type { Env } from '../env.ts';
import {
  acquireCodexRefreshLease,
  expireCodexAccessToken,
  getCodexConnection,
  markCodexReauthRequired,
  releaseCodexRefreshLease,
  replaceCodexTokens,
  type CodexOAuthConnectionRow,
} from '../db/codex-oauth.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../crypto/oauth-token.ts';
import { refreshCodexTokens, type CodexTokens } from './client.ts';

export interface ActiveCodexCredential {
  accessToken: string;
  accountId: string;
  connection: CodexOAuthConnectionRow;
}

async function decryptAccess(row: CodexOAuthConnectionRow, env: Env): Promise<ActiveCodexCredential> {
  return {
    accessToken: await decryptOAuthSecret(
      row.access_token_ciphertext, row.access_token_iv, env.MASTER_KEY, row.id, 'access', row.token_version,
    ),
    accountId: row.account_id,
    connection: row,
  };
}

async function encryptTokenPair(tokens: CodexTokens, env: Env, id: string, version: number) {
  const [access, refresh] = await Promise.all([
    encryptOAuthSecret(tokens.accessToken, env.MASTER_KEY, id, 'access', version),
    encryptOAuthSecret(tokens.refreshToken, env.MASTER_KEY, id, 'refresh', version),
  ]);
  return { access, refresh };
}

export async function ensureCodexCredential(
  env: Env,
  connectionId: string,
  fetcher: typeof fetch = fetch,
): Promise<ActiveCodexCredential> {
  let row = await getCodexConnection(env.DB, connectionId);
  if (!row || row.status !== 'active') throw new Error('Codex account requires authorization');
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at > now + 60) return decryptAccess(row, env);

  const acquired = await acquireCodexRefreshLease(env.DB, row.id, row.token_version, now);
  if (!acquired) {
    // Another isolate may have rotated the refresh token. Reload once instead
    // of trying the stale token, which could invalidate the account session.
    row = await getCodexConnection(env.DB, connectionId);
    if (row && row.status === 'active' && row.expires_at > now + 30) return decryptAccess(row, env);
    throw new Error('Codex credential refresh is already in progress');
  }

  try {
    const refreshToken = await decryptOAuthSecret(
      row.refresh_token_ciphertext, row.refresh_token_iv, env.MASTER_KEY, row.id, 'refresh', row.token_version,
    );
    const tokens = await refreshCodexTokens(refreshToken, fetcher, {
      accountId: row.account_id,
      email: row.email,
      planType: row.plan_type,
    });
    const nextVersion = row.token_version + 1;
    const encrypted = await encryptTokenPair(tokens, env, row.id, nextVersion);
    const replaced = await replaceCodexTokens(env.DB, row.id, row.token_version, {
      accessCiphertext: encrypted.access.ciphertext,
      accessIv: encrypted.access.iv,
      refreshCiphertext: encrypted.refresh.ciphertext,
      refreshIv: encrypted.refresh.iv,
      accountId: tokens.accountId,
      email: tokens.email,
      planType: tokens.planType,
      expiresAt: tokens.expiresAt,
    });
    if (!replaced) throw new Error('Codex credential changed during refresh');
    const fresh = await getCodexConnection(env.DB, row.id);
    if (!fresh) throw new Error('Codex credential disappeared after refresh');
    return decryptAccess(fresh, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/HTTP 400|HTTP 401|refresh_token/i.test(message)) {
      await markCodexReauthRequired(env.DB, row.id, row.token_version);
    } else {
      await releaseCodexRefreshLease(env.DB, row.id, row.token_version);
    }
    throw error;
  }
}

/** Force one refresh after the backend rejects an otherwise unexpired access token. */
export async function refreshRejectedCodexCredential(
  env: Env,
  connectionId: string,
  rejectedVersion: number,
  fetcher: typeof fetch = fetch,
): Promise<ActiveCodexCredential> {
  await expireCodexAccessToken(env.DB, connectionId, rejectedVersion);
  return ensureCodexCredential(env, connectionId, fetcher);
}

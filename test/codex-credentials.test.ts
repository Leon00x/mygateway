import { describe, expect, test, vi } from 'vitest';
import { ensureCodexCredential } from '../src/codex/credentials.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../src/crypto/oauth-token.ts';
import type { CodexOAuthConnectionRow } from '../src/db/codex-oauth.ts';
import type { Env } from '../src/env.ts';

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

class CredentialDatabase {
  constructor(public row: CodexOAuthConnectionRow) {}

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...input: unknown[]) => { values = input; return statement; },
      first: async () => sql.includes('FROM codex_oauth_connections') && values[0] === this.row.id
        ? { ...this.row } : null,
      run: async () => {
        let changes = 0;
        if (sql.includes('SET refresh_lease_until = ?') && this.row.id === values[1]
          && this.row.token_version === values[2]
          && (!this.row.refresh_lease_until || this.row.refresh_lease_until <= Number(values[3]))) {
          this.row.refresh_lease_until = Number(values[0]); changes = 1;
        } else if (sql.includes('token_version = token_version + 1')
          && this.row.id === values[8] && this.row.token_version === values[9]) {
          this.row.access_token_ciphertext = String(values[0]); this.row.access_token_iv = String(values[1]);
          this.row.refresh_token_ciphertext = String(values[2]); this.row.refresh_token_iv = String(values[3]);
          this.row.account_id = String(values[4]); this.row.email = values[5] as string | null;
          this.row.plan_type = values[6] as string | null; this.row.expires_at = Number(values[7]);
          this.row.token_version += 1; this.row.refresh_lease_until = null; changes = 1;
        } else if (sql.includes('SET refresh_lease_until = NULL') && this.row.id === values[0]) {
          this.row.refresh_lease_until = null; changes = 1;
        }
        return { meta: { changes } };
      },
    };
    return statement;
  }
}

async function fixture(expiresAt: number, refreshLeaseUntil: number | null = null) {
  const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
  const id = 'connection-1';
  const [access, refresh] = await Promise.all([
    encryptOAuthSecret('old-access', master, id, 'access', 1),
    encryptOAuthSecret('old-refresh', master, id, 'refresh', 1),
  ]);
  const row: CodexOAuthConnectionRow = {
    id,
    access_token_ciphertext: access.ciphertext,
    access_token_iv: access.iv,
    refresh_token_ciphertext: refresh.ciphertext,
    refresh_token_iv: refresh.iv,
    token_version: 1,
    account_id: 'acct-1',
    email: 'person@example.com',
    plan_type: 'plus',
    expires_at: expiresAt,
    status: 'active',
    refresh_lease_until: refreshLeaseUntil,
    created_at: 1,
    updated_at: 1,
  };
  const db = new CredentialDatabase(row);
  return { master, row, db, env: { DB: db as unknown as D1Database, MASTER_KEY: master } as Env };
}

describe('Codex credential rotation', () => {
  test('rotates both encrypted tokens with a version-bound compare-and-set', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { db, env, master } = await fixture(now - 10);
    const claims = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      access_token: jwt(claims), refresh_token: 'new-refresh', expires_in: 3600,
    }), { status: 200 })) as unknown as typeof fetch;

    const credential = await ensureCodexCredential(env, 'connection-1', fetcher);
    expect(credential.connection.token_version).toBe(2);
    expect(credential.accessToken).toBe(jwt(claims));
    expect(await decryptOAuthSecret(
      db.row.refresh_token_ciphertext, db.row.refresh_token_iv, master, db.row.id, 'refresh', 2,
    )).toBe('new-refresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('does not reuse a stale refresh token while another isolate owns the lease', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { env } = await fixture(now - 10, now + 20);
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(ensureCodexCredential(env, 'connection-1', fetcher))
      .rejects.toThrow('refresh is already in progress');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

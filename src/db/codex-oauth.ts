/** D1 persistence for the experimental ChatGPT/Codex OAuth connection. */

export interface CodexOAuthConnectionRow {
  id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  token_version: number;
  account_id: string;
  email: string | null;
  plan_type: string | null;
  expires_at: number;
  status: 'active' | 'reauth_required';
  refresh_lease_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface CodexDeviceFlowRow {
  id: string;
  device_auth_ciphertext: string;
  device_auth_iv: string;
  user_code: string;
  poll_interval_seconds: number;
  expires_at: number;
  last_polled_at: number | null;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  error_summary: string | null;
  connection_id: string | null;
  created_at: number;
  updated_at: number;
}

export async function getActiveCodexConnection(db: D1Database): Promise<CodexOAuthConnectionRow | null> {
  return db.prepare(
    `SELECT * FROM codex_oauth_connections
     WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
  ).first<CodexOAuthConnectionRow>();
}

export async function getLatestCodexConnection(db: D1Database): Promise<CodexOAuthConnectionRow | null> {
  return db.prepare('SELECT * FROM codex_oauth_connections ORDER BY created_at DESC LIMIT 1')
    .first<CodexOAuthConnectionRow>();
}

export async function getCodexConnection(db: D1Database, id: string): Promise<CodexOAuthConnectionRow | null> {
  return db.prepare('SELECT * FROM codex_oauth_connections WHERE id = ?')
    .bind(id).first<CodexOAuthConnectionRow>();
}

export async function createCodexConnection(
  db: D1Database,
  connection: Omit<CodexOAuthConnectionRow, 'created_at' | 'updated_at' | 'refresh_lease_until'>,
): Promise<void> {
  await db.prepare(
    `INSERT INTO codex_oauth_connections
      (id, access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv,
       token_version, account_id, email, plan_type, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    connection.id, connection.access_token_ciphertext, connection.access_token_iv,
    connection.refresh_token_ciphertext, connection.refresh_token_iv, connection.token_version,
    connection.account_id, connection.email, connection.plan_type, connection.expires_at, connection.status,
  ).run();
}

export async function replaceCodexTokens(
  db: D1Database,
  id: string,
  expectedVersion: number,
  update: {
    accessCiphertext: string; accessIv: string; refreshCiphertext: string; refreshIv: string;
    accountId: string; email: string | null; planType: string | null; expiresAt: number;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE codex_oauth_connections SET
       access_token_ciphertext = ?, access_token_iv = ?,
       refresh_token_ciphertext = ?, refresh_token_iv = ?,
       account_id = ?, email = ?, plan_type = ?, expires_at = ?,
       token_version = token_version + 1, refresh_lease_until = NULL,
       status = 'active', updated_at = unixepoch()
     WHERE id = ? AND token_version = ?`,
  ).bind(
    update.accessCiphertext, update.accessIv, update.refreshCiphertext, update.refreshIv,
    update.accountId, update.email, update.planType, update.expiresAt, id, expectedVersion,
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function acquireCodexRefreshLease(
  db: D1Database,
  id: string,
  expectedVersion: number,
  now: number,
  leaseSeconds = 30,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE codex_oauth_connections SET refresh_lease_until = ?, updated_at = unixepoch()
     WHERE id = ? AND token_version = ? AND status = 'active'
       AND (refresh_lease_until IS NULL OR refresh_lease_until <= ?)`,
  ).bind(now + leaseSeconds, id, expectedVersion, now).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseCodexRefreshLease(
  db: D1Database,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await db.prepare(
    'UPDATE codex_oauth_connections SET refresh_lease_until = NULL WHERE id = ? AND token_version = ?',
  ).bind(id, expectedVersion).run();
}

export async function expireCodexAccessToken(
  db: D1Database,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await db.prepare(
    `UPDATE codex_oauth_connections SET expires_at = 0, updated_at = unixepoch()
     WHERE id = ? AND token_version = ? AND status = 'active'`,
  ).bind(id, expectedVersion).run();
}

export async function markCodexReauthRequired(
  db: D1Database,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await db.prepare(
    `UPDATE codex_oauth_connections SET status = 'reauth_required', refresh_lease_until = NULL,
       updated_at = unixepoch() WHERE id = ? AND token_version = ?`,
  ).bind(id, expectedVersion).run();
}

export async function deleteCodexConnection(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE channels SET status = 'disabled', deleted_at = unixepoch(), updated_at = unixepoch()
      WHERE oauth_connection_id = ?`).bind(id),
    db.prepare('DELETE FROM codex_oauth_connections WHERE id = ?').bind(id),
  ]);
}

export async function createCodexDeviceFlow(
  db: D1Database,
  flow: Omit<CodexDeviceFlowRow, 'created_at' | 'updated_at' | 'last_polled_at' | 'error_summary' | 'connection_id'>,
): Promise<void> {
  await db.prepare(
    `INSERT INTO codex_device_flows
      (id, device_auth_ciphertext, device_auth_iv, user_code, poll_interval_seconds, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    flow.id, flow.device_auth_ciphertext, flow.device_auth_iv, flow.user_code,
    flow.poll_interval_seconds, flow.expires_at, flow.status,
  ).run();
}

export async function getCodexDeviceFlow(db: D1Database, id: string): Promise<CodexDeviceFlowRow | null> {
  return db.prepare('SELECT * FROM codex_device_flows WHERE id = ?')
    .bind(id).first<CodexDeviceFlowRow>();
}

export async function recordCodexDevicePoll(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE codex_device_flows SET last_polled_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at > ?
       AND (last_polled_at IS NULL OR last_polled_at + poll_interval_seconds <= ?)`,
  ).bind(now, now, id, now, now).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function completeCodexDeviceFlow(db: D1Database, id: string, connectionId: string): Promise<void> {
  await db.prepare(
    `UPDATE codex_device_flows SET status = 'completed', connection_id = ?, updated_at = unixepoch()
     WHERE id = ?`,
  ).bind(connectionId, id).run();
}

export async function failCodexDeviceFlow(
  db: D1Database,
  id: string,
  status: 'expired' | 'failed',
  message: string,
): Promise<void> {
  await db.prepare(
    `UPDATE codex_device_flows SET status = ?, error_summary = ?, updated_at = unixepoch() WHERE id = ?`,
  ).bind(status, message.slice(0, 300), id).run();
}

export async function cleanupCodexDeviceFlows(db: D1Database, now: number): Promise<void> {
  await db.prepare(
    `DELETE FROM codex_device_flows WHERE expires_at < ? OR (status != 'pending' AND updated_at < ?)`,
  ).bind(now - 3600, now - 86400).run();
}

import { generateId } from '../shared/ids.ts';
import { PasswordDigest } from '../auth/password.ts';

export interface AdminUserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  must_change_password: 0 | 1;
  session_version: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}
export async function getAdminByUsername(db: D1Database, username: string): Promise<AdminUserRow | null> {
  return db.prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1').bind(username).first<AdminUserRow>();
}

export async function getAdminById(db: D1Database, id: string): Promise<AdminUserRow | null> {
  return db.prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1').bind(id).first<AdminUserRow>();
}

export async function hasAdminUser(db: D1Database): Promise<boolean> {
  const result = await db.prepare('SELECT COUNT(*) AS count FROM admin_users').first<{ count: number }>();
  return (result?.count ?? 0) > 0;
}

export async function createInitialAdmin(
  db: D1Database,
  username: string,
  digest: PasswordDigest,
): Promise<AdminUserRow> {
  const id = generateId();
  await db.prepare(
    `INSERT INTO admin_users (
      id, username, password_hash, password_salt, password_iterations, must_change_password
    ) VALUES (?, ?, ?, ?, ?, 1)`,
  ).bind(id, username, digest.hash, digest.salt, digest.iterations).run();
  return (await getAdminById(db, id))!;
}

export async function recordAdminLogin(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), id)
    .run();
}

export async function updateAdminCredentials(
  db: D1Database,
  id: string,
  username: string,
  digest: PasswordDigest,
): Promise<AdminUserRow> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE admin_users SET
      username = ?, password_hash = ?, password_salt = ?, password_iterations = ?,
      must_change_password = 0, session_version = session_version + 1, updated_at = ?
    WHERE id = ?`,
  ).bind(username, digest.hash, digest.salt, digest.iterations, now, id).run();
  return (await getAdminById(db, id))!;
}

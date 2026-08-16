import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const persistenceDirectory = mkdtempSync(join(tmpdir(), 'mygateway-migrations-'));
const wrangler = join(
  repositoryRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

function run(args, json = false) {
  const result = spawnSync(wrangler, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
  }
  return json ? JSON.parse(result.stdout) : result.stdout;
}

function query(sql) {
  const response = run([
    'd1', 'execute', 'DB', '--local', '--persist-to', persistenceDirectory,
    '--env=', '--command', sql, '--json',
  ], true);
  return response[0]?.results ?? [];
}

try {
  const expectedMigrationCount = readdirSync(join(repositoryRoot, 'migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  const migrationArgs = [
    'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistenceDirectory, '--env=',
  ];
  run(migrationArgs);

  const summary = query(`SELECT
    (SELECT COUNT(*) FROM model_prices) AS price_count,
    (SELECT COUNT(*) FROM system_settings) AS setting_count,
    (SELECT COUNT(*) FROM d1_migrations) AS migration_count`)[0];
  if (summary?.price_count < 30 || summary?.setting_count < 6 || summary?.migration_count !== expectedMigrationCount) {
    throw new Error(`Unexpected baseline summary: ${JSON.stringify(summary)}`);
  }

  const tableNames = query(`SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
      AND name != 'd1_migrations'
    ORDER BY name`).map((row) => row.name);
  const expectedTables = [
    'admin_users',
    'analytics_minutes',
    'channel_model_discovery',
    'channel_models',
    'channel_protocols',
    'channel_provider_models',
    'channels',
    'gateway_api_keys',
    'key_daily_usage',
    'management_audit_logs',
    'management_keys',
    'model_cards',
    'model_identifiers',
    'model_prices',
    'request_logs',
    'system_settings',
  ];
  const missingTables = expectedTables.filter((name) => !tableNames.includes(name));
  if (missingTables.length > 0) {
    throw new Error(`Missing baseline tables: ${JSON.stringify(missingTables)}`);
  }
  for (const retiredTable of ['codex_device_flows', 'codex_oauth_connections', 'usage_minutes']) {
    if (tableNames.includes(retiredTable)) throw new Error(`Retired table remains: ${retiredTable}`);
  }

  const gatewayKeyColumns = query('PRAGMA table_info(gateway_api_keys)').map((row) => row.name);
  for (const column of ['request_limit', 'token_limit', 'limit_period', 'is_temporary']) {
    if (!gatewayKeyColumns.includes(column)) throw new Error(`Missing gateway_api_keys.${column}`);
  }
  for (const retiredColumn of ['daily_request_limit', 'daily_token_limit']) {
    if (gatewayKeyColumns.includes(retiredColumn)) throw new Error(`Retired column remains: ${retiredColumn}`);
  }

  run(migrationArgs);
  const migrationCount = query('SELECT COUNT(*) AS count FROM d1_migrations')[0]?.count;
  if (migrationCount !== expectedMigrationCount) {
    throw new Error(`Migration rerun changed ledger count to ${migrationCount}`);
  }

  console.log('Migration baseline check passed (fresh schema, seeds, and idempotent rerun).');
} finally {
  rmSync(persistenceDirectory, { recursive: true, force: true });
}

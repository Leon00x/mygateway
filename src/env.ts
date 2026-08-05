/**
 * Worker Env bindings and runtime configuration.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** Initial admin username. Defaults to admin. */
  INITIAL_ADMIN_USERNAME?: string;

  /** One-time initial password. Set to the documented bootstrap value on first deploy. */
  INITIAL_ADMIN_PASSWORD?: string;

  /** Legacy bootstrap password for deployments upgrading from v0.1. */
  ADMIN_TOKEN?: string;

  /** 32-byte random key, base64-encoded. Used for Provider Key AES-GCM. */
  MASTER_KEY: string;

  /** App version injected via wrangler vars. */
  APP_VERSION?: string;

  /** Timezone for "today" dashboard boundary. Default: Asia/Shanghai */
  DEFAULT_TIMEZONE?: string;

  /** Max request body size in bytes. Default: 2097152 (2 MiB) */
  MAX_REQUEST_BYTES?: string;

  /** Max channel attempts per request. Default: 3 */
  MAX_CHANNEL_ATTEMPTS?: string;

  /** Per-candidate upstream header timeout in ms. Default: 30000 */
  UPSTREAM_HEADER_TIMEOUT_MS?: string;

  /** Usage retention in days. Default: 30 */
  USAGE_RETENTION_DAYS?: string;

  /** Recent request log retention in days. Default: 7 */
  REQUEST_LOG_RETENTION_DAYS?: string;

  /**
   * TTL for the non-streaming response cache, in ms. 0 disables caching.
   * Default: 0 (disabled). The cache is isolate-local.
   */
  RESPONSE_CACHE_TTL_MS?: string;

  /** Max entries in the per-isolate response cache. Default: 1000 */
  RESPONSE_CACHE_MAX_ENTRIES?: string;
}

/** Parsed numeric config with validated defaults. */
export interface RuntimeConfig {
  appVersion: string;
  defaultTimezone: string;
  maxRequestBytes: number;
  maxChannelAttempts: number;
  upstreamHeaderTimeoutMs: number;
  usageRetentionDays: number;
  requestLogRetentionDays: number;
  responseCacheTtlMs: number;
  responseCacheMaxEntries: number;
}

const DEFAULTS = {
  appVersion: '0.1.0',
  defaultTimezone: 'Asia/Shanghai',
  maxRequestBytes: 2_097_152,
  maxChannelAttempts: 3,
  upstreamHeaderTimeoutMs: 30_000,
  usageRetentionDays: 30,
  requestLogRetentionDays: 7,
  responseCacheTtlMs: 0,
  responseCacheMaxEntries: 1_000,
} as const;

/**
 * Parse and validate Env into a RuntimeConfig.
 * Throws on missing or invalid secrets in production.
 */
export function parseConfig(env: Env): RuntimeConfig {
  if (!env.MASTER_KEY) {
    throw new ConfigError('MASTER_KEY is required');
  }
  try {
    const keyBytes = Uint8Array.from(atob(env.MASTER_KEY), (c) => c.charCodeAt(0));
    if (keyBytes.length !== 32) {
      throw new ConfigError('MASTER_KEY must decode to exactly 32 bytes');
    }
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError('MASTER_KEY is not valid base64');
  }

  return {
    appVersion: env.APP_VERSION ?? DEFAULTS.appVersion,
    defaultTimezone: env.DEFAULT_TIMEZONE ?? DEFAULTS.defaultTimezone,
    maxRequestBytes: parseInt(env.MAX_REQUEST_BYTES ?? '', 10) || DEFAULTS.maxRequestBytes,
    maxChannelAttempts: parseInt(env.MAX_CHANNEL_ATTEMPTS ?? '', 10) || DEFAULTS.maxChannelAttempts,
    upstreamHeaderTimeoutMs:
      parseInt(env.UPSTREAM_HEADER_TIMEOUT_MS ?? '', 10) || DEFAULTS.upstreamHeaderTimeoutMs,
    usageRetentionDays: parseInt(env.USAGE_RETENTION_DAYS ?? '', 10) || DEFAULTS.usageRetentionDays,
    requestLogRetentionDays:
      parseInt(env.REQUEST_LOG_RETENTION_DAYS ?? '', 10) || DEFAULTS.requestLogRetentionDays,
    responseCacheTtlMs: parseInt(env.RESPONSE_CACHE_TTL_MS ?? '', 10) || DEFAULTS.responseCacheTtlMs,
    responseCacheMaxEntries:
      parseInt(env.RESPONSE_CACHE_MAX_ENTRIES ?? '', 10) || DEFAULTS.responseCacheMaxEntries,
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

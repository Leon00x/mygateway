-- A provider channel can expose multiple native wire protocols with one API key.

CREATE TABLE channel_protocols (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL
    CHECK (protocol IN ('openai_chat', 'openai_responses', 'anthropic_messages')),
  base_url TEXT NOT NULL,
  auth_scheme TEXT NOT NULL DEFAULT 'bearer'
    CHECK (auth_scheme IN ('bearer', 'x_api_key')),
  api_version TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, protocol)
);

CREATE INDEX idx_channel_protocols_protocol
  ON channel_protocols(protocol, channel_id);

-- Preserve existing installations: every old channel was a Chat-compatible channel.
INSERT INTO channel_protocols (channel_id, protocol, base_url, auth_scheme)
SELECT id, 'openai_chat', base_url, 'bearer'
FROM channels
WHERE deleted_at IS NULL;

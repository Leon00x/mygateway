-- Retire the experimental ChatGPT/Codex subscription channel.
-- The 0014 columns and empty tables remain as migration-history compatibility tombstones.

UPDATE channel_models
SET status = 'disabled',
    deleted_at = COALESCE(deleted_at, unixepoch()),
    updated_at = unixepoch()
WHERE channel_id IN (
  SELECT id FROM channels WHERE auth_type = 'codex_oauth'
);

DELETE FROM model_identifiers
WHERE model_card_id IN (
    SELECT cm.model_card_id
    FROM channel_models cm
    JOIN channels c ON c.id = cm.channel_id
    WHERE c.auth_type = 'codex_oauth'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM channel_models active_instance
    JOIN channels active_channel ON active_channel.id = active_instance.channel_id
    WHERE active_instance.model_card_id = model_identifiers.model_card_id
      AND active_instance.deleted_at IS NULL
      AND active_channel.deleted_at IS NULL
  );

UPDATE model_cards
SET status = 'disabled',
    deleted_at = COALESCE(deleted_at, unixepoch()),
    updated_at = unixepoch()
WHERE id IN (
    SELECT cm.model_card_id
    FROM channel_models cm
    JOIN channels c ON c.id = cm.channel_id
    WHERE c.auth_type = 'codex_oauth'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM channel_models active_instance
    JOIN channels active_channel ON active_channel.id = active_instance.channel_id
    WHERE active_instance.model_card_id = model_cards.id
      AND active_instance.deleted_at IS NULL
      AND active_channel.deleted_at IS NULL
  );

UPDATE channels
SET status = 'disabled',
    deleted_at = COALESCE(deleted_at, unixepoch()),
    updated_at = unixepoch()
WHERE auth_type = 'codex_oauth';

DELETE FROM codex_device_flows;
DELETE FROM codex_oauth_connections;

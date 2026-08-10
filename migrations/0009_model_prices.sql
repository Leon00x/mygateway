-- Migration: 0009_model_prices
-- Global model price baseline (mainstream models), editable from the console.
-- Prices are micro-USD/CNY per 1,000,000 tokens; cache price applies to
-- prompt-cache-hit tokens (DeepSeek, Anthropic, OpenAI).
-- NOTE: values are a baseline from public pricing pages — always editable.

CREATE TABLE model_prices (
  provider_model_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_price_micros_per_million INTEGER NOT NULL DEFAULT 0,
  output_price_micros_per_million INTEGER NOT NULL DEFAULT 0,
  cache_input_price_micros_per_million INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Channel instances: optional cache-hit price (currency already exists).
ALTER TABLE channel_models ADD COLUMN cache_input_price_micros_per_million INTEGER;

INSERT INTO model_prices (provider_model_id, display_name, provider, input_price_micros_per_million, output_price_micros_per_million, cache_input_price_micros_per_million, currency) VALUES
  -- DeepSeek (USD)
  ('deepseek-chat', 'DeepSeek Chat (V3)', 'deepseek', 270000, 1100000, 70000, 'USD'),
  ('deepseek-reasoner', 'DeepSeek Reasoner (R1)', 'deepseek', 550000, 2190000, 140000, 'USD'),
  ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 270000, 1100000, 70000, 'USD'),
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 550000, 2190000, 140000, 'USD'),
  -- OpenAI (USD)
  ('gpt-4o', 'GPT-4o', 'openai', 2500000, 10000000, 1250000, 'USD'),
  ('gpt-4o-mini', 'GPT-4o mini', 'openai', 150000, 600000, 75000, 'USD'),
  ('gpt-4.1', 'GPT-4.1', 'openai', 2000000, 8000000, 500000, 'USD'),
  ('gpt-4.1-mini', 'GPT-4.1 mini', 'openai', 400000, 1600000, 100000, 'USD'),
  ('gpt-4.1-nano', 'GPT-4.1 nano', 'openai', 100000, 400000, 25000, 'USD'),
  ('gpt-5', 'GPT-5', 'openai', 1250000, 10000000, 250000, 'USD'),
  ('gpt-5-mini', 'GPT-5 mini', 'openai', 250000, 2000000, 50000, 'USD'),
  ('o3', 'o3', 'openai', 10000000, 40000000, NULL, 'USD'),
  ('o4-mini', 'o4-mini', 'openai', 1100000, 4400000, NULL, 'USD'),
  -- Anthropic (USD)
  ('claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'anthropic', 3000000, 15000000, 300000, 'USD'),
  ('claude-3-7-sonnet', 'Claude 3.7 Sonnet', 'anthropic', 3000000, 15000000, 300000, 'USD'),
  ('claude-3-5-haiku', 'Claude 3.5 Haiku', 'anthropic', 800000, 4000000, 80000, 'USD'),
  ('claude-4-sonnet', 'Claude 4 Sonnet', 'anthropic', 3000000, 15000000, 300000, 'USD'),
  ('claude-4-opus', 'Claude 4 Opus', 'anthropic', 15000000, 75000000, 1500000, 'USD'),
  ('claude-4-5-sonnet', 'Claude 4.5 Sonnet', 'anthropic', 3000000, 15000000, 300000, 'USD'),
  ('claude-4-5-haiku', 'Claude 4.5 Haiku', 'anthropic', 1000000, 5000000, 100000, 'USD'),
  -- Google (USD)
  ('gemini-2.0-flash', 'Gemini 2.0 Flash', 'google_gemini', 100000, 400000, 25000, 'USD'),
  ('gemini-2.5-flash', 'Gemini 2.5 Flash', 'google_gemini', 300000, 2500000, 75000, 'USD'),
  ('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'google_gemini', 100000, 400000, 25000, 'USD'),
  ('gemini-2.5-pro', 'Gemini 2.5 Pro', 'google_gemini', 1250000, 10000000, 312500, 'USD'),
  -- Groq (USD)
  ('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'groq', 590000, 790000, NULL, 'USD'),
  ('llama-3.1-8b-instant', 'Llama 3.1 8B', 'groq', 50000, 80000, NULL, 'USD'),
  -- Mistral (USD)
  ('mistral-large-latest', 'Mistral Large', 'mistral', 2000000, 6000000, NULL, 'USD'),
  ('mistral-small-latest', 'Mistral Small', 'mistral', 100000, 300000, NULL, 'USD'),
  ('codestral-latest', 'Codestral', 'mistral', 250000, 1250000, NULL, 'USD'),
  -- Moonshot / Kimi (CNY)
  ('moonshot-v1-8k', 'Moonshot v1 8K', 'moonshot', 12000000, 12000000, NULL, 'CNY'),
  ('moonshot-v1-32k', 'Moonshot v1 32K', 'moonshot', 24000000, 24000000, NULL, 'CNY'),
  ('moonshot-v1-128k', 'Moonshot v1 128K', 'moonshot', 60000000, 60000000, NULL, 'CNY'),
  -- Zhipu / GLM (CNY)
  ('glm-4-plus', 'GLM-4-Plus', 'zhipu', 50000000, 50000000, NULL, 'CNY'),
  ('glm-4-flash', 'GLM-4-Flash', 'zhipu', 0, 0, NULL, 'CNY'),
  -- MiniMax (USD)
  ('minimax-text-01', 'MiniMax Text-01', 'minimax_intl', 200000, 1100000, NULL, 'USD');

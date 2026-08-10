-- Migration: 0011_refresh_model_prices
-- Refresh the built-in USD PAYG baseline verified on 2026-08-11.
--
-- Administrators can edit model_prices. Remove a legacy row only when every
-- editable value still equals the 0009 seed, then INSERT OR IGNORE the new
-- baseline. This upgrades untouched installs without overwriting local edits.

CREATE TABLE _migration_0011_legacy_model_prices (
  provider_model_id TEXT PRIMARY KEY,
  input_price INTEGER NOT NULL,
  output_price INTEGER NOT NULL,
  cache_price INTEGER,
  currency TEXT NOT NULL
);

INSERT INTO _migration_0011_legacy_model_prices VALUES
  ('deepseek-chat',270000,1100000,70000,'USD'),
  ('deepseek-reasoner',550000,2190000,140000,'USD'),
  ('deepseek-v4-flash',270000,1100000,70000,'USD'),
  ('deepseek-v4-pro',550000,2190000,140000,'USD'),
  ('gpt-4o',2500000,10000000,1250000,'USD'),
  ('gpt-4o-mini',150000,600000,75000,'USD'),
  ('gpt-4.1',2000000,8000000,500000,'USD'),
  ('gpt-4.1-mini',400000,1600000,100000,'USD'),
  ('gpt-4.1-nano',100000,400000,25000,'USD'),
  ('gpt-5',1250000,10000000,250000,'USD'),
  ('gpt-5-mini',250000,2000000,50000,'USD'),
  ('o3',10000000,40000000,NULL,'USD'),
  ('o4-mini',1100000,4400000,NULL,'USD'),
  ('claude-3-5-sonnet',3000000,15000000,300000,'USD'),
  ('claude-3-7-sonnet',3000000,15000000,300000,'USD'),
  ('claude-3-5-haiku',800000,4000000,80000,'USD'),
  ('claude-4-sonnet',3000000,15000000,300000,'USD'),
  ('claude-4-opus',15000000,75000000,1500000,'USD'),
  ('claude-4-5-sonnet',3000000,15000000,300000,'USD'),
  ('claude-4-5-haiku',1000000,5000000,100000,'USD'),
  ('gemini-2.0-flash',100000,400000,25000,'USD'),
  ('gemini-2.5-flash',300000,2500000,75000,'USD'),
  ('gemini-2.5-flash-lite',100000,400000,25000,'USD'),
  ('gemini-2.5-pro',1250000,10000000,312500,'USD'),
  ('llama-3.3-70b-versatile',590000,790000,NULL,'USD'),
  ('llama-3.1-8b-instant',50000,80000,NULL,'USD'),
  ('mistral-large-latest',2000000,6000000,NULL,'USD'),
  ('mistral-small-latest',100000,300000,NULL,'USD'),
  ('codestral-latest',250000,1250000,NULL,'USD'),
  ('moonshot-v1-8k',12000000,12000000,NULL,'CNY'),
  ('moonshot-v1-32k',24000000,24000000,NULL,'CNY'),
  ('moonshot-v1-128k',60000000,60000000,NULL,'CNY'),
  ('glm-4-plus',50000000,50000000,NULL,'CNY'),
  ('glm-4-flash',0,0,NULL,'CNY'),
  ('minimax-text-01',200000,1100000,NULL,'USD');

DELETE FROM model_prices
WHERE EXISTS (
  SELECT 1
  FROM _migration_0011_legacy_model_prices AS legacy
  WHERE legacy.provider_model_id = model_prices.provider_model_id
    AND legacy.input_price = model_prices.input_price_micros_per_million
    AND legacy.output_price = model_prices.output_price_micros_per_million
    AND legacy.cache_price IS model_prices.cache_input_price_micros_per_million
    AND legacy.currency = model_prices.currency
);

DROP TABLE _migration_0011_legacy_model_prices;

INSERT OR IGNORE INTO model_prices (
  provider_model_id, display_name, provider,
  input_price_micros_per_million, output_price_micros_per_million,
  cache_input_price_micros_per_million, currency
) VALUES
  ('deepseek-v4-flash','DeepSeek V4 Flash','deepseek',140000,280000,2800,'USD'),
  ('deepseek-v4-pro','DeepSeek V4 Pro','deepseek',435000,870000,3625,'USD'),
  ('glm-5.1','GLM-5.1','zai',1400000,4400000,260000,'USD'),
  ('glm-5','GLM-5','zai',1000000,3200000,200000,'USD'),
  ('glm-4.7','GLM-4.7','zai',600000,2200000,110000,'USD'),
  ('qwen3.7-max','Qwen3.7 Max','alibaba_cloud_intl',2500000,7500000,NULL,'USD'),
  ('qwen3.7-plus','Qwen3.7 Plus','alibaba_cloud_intl',400000,1600000,NULL,'USD'),
  ('qwen3.6-flash','Qwen3.6 Flash','alibaba_cloud_intl',250000,1500000,NULL,'USD'),
  ('seed-2-0-pro-260328','Seed 2.0 Pro','byteplus_modelark',500000,3000000,100000,'USD'),
  ('seed-2-0-lite-260428','Seed 2.0 Lite','byteplus_modelark',250000,2000000,50000,'USD'),
  ('seed-2-0-mini-260428','Seed 2.0 Mini','byteplus_modelark',100000,400000,20000,'USD'),
  ('gemini-3.6-flash','Gemini 3.6 Flash','google_gemini',1500000,7500000,150000,'USD'),
  ('gemini-3.5-flash','Gemini 3.5 Flash','google_gemini',1500000,9000000,150000,'USD'),
  ('gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite','google_gemini',300000,2500000,30000,'USD'),
  ('openai/gpt-oss-120b','GPT OSS 120B','groq',150000,600000,NULL,'USD'),
  ('openai/gpt-oss-20b','GPT OSS 20B','groq',75000,300000,NULL,'USD'),
  ('llama-3.3-70b-versatile','Llama 3.3 70B','groq',590000,790000,NULL,'USD'),
  ('MiniMax-M3','MiniMax M3','minimax_intl',300000,1200000,60000,'USD'),
  ('MiniMax-M2.7','MiniMax M2.7','minimax_intl',300000,1200000,60000,'USD'),
  ('MiniMax-M2.7-highspeed','MiniMax M2.7 Highspeed','minimax_intl',600000,2400000,60000,'USD'),
  ('grok-4.5','Grok 4.5','xai',2000000,6000000,300000,'USD'),
  ('grok-4.3','Grok 4.3','xai',1250000,2500000,200000,'USD'),
  ('mistral-large-2512','Mistral Large 3','mistral',500000,1500000,NULL,'USD'),
  ('mistral-medium-3-5','Mistral Medium 3.5','mistral',1500000,7500000,NULL,'USD'),
  ('mistral-small-2603','Mistral Small 4','mistral',150000,600000,NULL,'USD'),
  ('gpt-5.4','GPT-5.4','openai',2500000,15000000,250000,'USD'),
  ('gpt-5.4-mini','GPT-5.4 mini','openai',750000,4500000,75000,'USD'),
  ('gpt-5.4-nano','GPT-5.4 nano','openai',200000,1250000,20000,'USD'),
  ('claude-opus-5','Claude Opus 5','anthropic',5000000,25000000,500000,'USD'),
  ('claude-sonnet-5','Claude Sonnet 5','anthropic',3000000,15000000,300000,'USD');

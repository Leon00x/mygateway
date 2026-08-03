/**
 * System settings and provider presets API.
 */

import { Env } from '../env.ts';
import { json } from './router.ts';

/**
 * Provider presets — served from config, not hardcoded in gateway logic.
 * Add entries here to make new providers available as "Quick Add" in the dashboard.
 */
const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider_type: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    docs_url: 'https://api-docs.deepseek.com/zh-cn/',
    description: 'DeepSeek V3 / R1 等模型，OpenAI 兼容接口',
    popular_models: ['deepseek-chat', 'deepseek-reasoner'],
    supports_stream_usage: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    docs_url: 'https://platform.openai.com/docs/api-reference',
    description: 'GPT-4o / GPT-4.1 / o3 等模型',
    popular_models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
    supports_stream_usage: true,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    provider_type: 'openai_compatible',
    base_url: 'https://api.siliconflow.cn/v1',
    docs_url: 'https://docs.siliconflow.cn/',
    description: '硅基流动，国内加速访问多种开源模型',
    popular_models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B'],
    supports_stream_usage: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    provider_type: 'openai_compatible',
    base_url: 'https://api.moonshot.cn/v1',
    docs_url: 'https://platform.moonshot.cn/docs/api/chat',
    description: '月之暗面 Kimi 模型',
    popular_models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    supports_stream_usage: false,
  },
  {
    id: 'zhipu',
    name: '智谱 (GLM)',
    provider_type: 'openai_compatible',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    docs_url: 'https://open.bigmodel.cn/dev/api/thirdparty-frame/openai-sdk',
    description: '智谱 GLM-4 系列，OpenAI 兼容接口',
    popular_models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
    supports_stream_usage: true,
  },
];

/**
 * GET /admin/api/system/presets
 */
export function handleProviderPresets(requestId: string): Response {
  return json({ presets: PROVIDER_PRESETS });
}

/**
 * GET/PUT /admin/api/system/settings
 */
export async function handleSystemSettings(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const result = await env.DB
      .prepare('SELECT key, value, updated_at FROM system_settings')
      .all();
    const settings: Record<string, { value: string; updated_at: number }> = {};
    for (const row of result.results as { key: string; value: string; updated_at: number }[]) {
      settings[row.key] = { value: row.value, updated_at: row.updated_at };
    }
    return json({ settings });
  }

  if (request.method === 'PUT') {
    try {
      const body = (await request.json()) as Record<string, string>;
      const now = Math.floor(Date.now() / 1000);
      for (const [key, value] of Object.entries(body)) {
        await env.DB
          .prepare(
            'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?',
          )
          .bind(key, value, now, value, now)
          .run();
      }
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}

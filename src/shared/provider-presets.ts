/**
 * Provider presets shared by the Worker admin API and the dashboard.
 *
 * A protocol base URL is the parent URL to which the gateway appends
 * /chat/completions, /responses, or /messages. Only endpoints confirmed in
 * provider documentation belong here.
 */

export type ProviderPresetProtocol = 'openai_chat' | 'openai_responses' | 'anthropic_messages';

export interface ProviderPreset {
  /** Unique preset id */
  id: string;
  /** Display name */
  name: string;
  /** Provider type for the channel */
  provider_type: 'openai' | 'openai_compatible';
  /** Default base URL */
  base_url: string;
  /** Documentation URL */
  docs_url: string;
  /** Short description */
  description: string;
  /** Popular model IDs this provider offers (for reference) */
  popular_models: string[];
  /** Whether this provider supports stream_options.include_usage */
  supports_stream_usage: boolean;
  /** Native protocols configured automatically with the same API key. */
  protocols: Array<{
    protocol: ProviderPresetProtocol;
    base_url: string;
    auth_scheme: 'bearer' | 'x_api_key';
    api_version?: string;
  }>;
}

export interface ProviderModelDiscovery {
  /** Path appended to the selected protocol base URL. */
  path: string;
  /** Documented discovery base when it differs from inference base URL. */
  base_url?: string;
  /** Protocol endpoint whose authentication and base URL should be used. */
  protocol: ProviderPresetProtocol;
  /** Pagination convention documented by the provider. */
  pagination: 'none' | 'anthropic_cursor' | 'page_token';
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider_type: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    docs_url: 'https://api-docs.deepseek.com/zh-cn/',
    description: 'DeepSeek V4 官方 API，原生支持 Chat 与 Messages',
    popular_models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    supports_stream_usage: true,
    protocols: [
      { protocol: 'openai_chat', base_url: 'https://api.deepseek.com/v1', auth_scheme: 'bearer' },
      {
        protocol: 'anthropic_messages',
        base_url: 'https://api.deepseek.com/anthropic',
        auth_scheme: 'x_api_key',
        api_version: '2023-06-01',
      },
    ],
  },
  {
    id: 'zai',
    name: 'Z.AI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.z.ai/api/paas/v4',
    docs_url: 'https://docs.z.ai/guides/develop/openai/python',
    description: 'Z.AI 国际站 GLM 系列，OpenAI Chat 兼容接口',
    popular_models: ['glm-5.1', 'glm-5', 'glm-4.7'],
    supports_stream_usage: true,
    protocols: [{ protocol: 'openai_chat', base_url: 'https://api.z.ai/api/paas/v4', auth_scheme: 'bearer' }],
  },
  {
    id: 'huawei_cloud_cn',
    name: '华为云（中国）',
    provider_type: 'openai_compatible',
    base_url: 'https://api.modelarts-maas.com/openai/v1',
    docs_url: 'https://support.huaweicloud.com/model-call-maas/model-call-021.html',
    description: 'ModelArts Studio MaaS 中国区，原生支持 Chat 与 Messages',
    popular_models: ['glm-5.2', 'deepseek-v4-pro', 'deepseek-v4-flash'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://api.modelarts-maas.com/openai/v1',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'anthropic_messages',
        base_url: 'https://api.modelarts-maas.com/anthropic/v1',
        auth_scheme: 'x_api_key',
        api_version: '2023-06-01',
      },
    ],
  },
  {
    id: 'alibaba_cloud_intl',
    name: '阿里云国际',
    provider_type: 'openai_compatible',
    base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    docs_url: 'https://www.alibabacloud.com/help/en/model-studio/base-url',
    description: 'Model Studio 新加坡共享端点，原生支持 Chat 与 Messages',
    popular_models: ['qwen3.7-plus', 'qwen3.7-max', 'qwen3.6-flash'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'anthropic_messages',
        base_url: 'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1',
        auth_scheme: 'x_api_key',
        api_version: '2023-06-01',
      },
    ],
  },
  {
    id: 'byteplus_modelark',
    name: '火山国际（BytePlus）',
    provider_type: 'openai_compatible',
    base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    docs_url: 'https://docs.byteplus.com/en/docs/ModelArk/1330626',
    description: 'BytePlus ModelArk 新加坡端点，原生支持 Chat 与 Responses',
    popular_models: ['seed-2-0-pro-260328', 'seed-2-0-lite-260428', 'seed-2-0-mini-260428'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'openai_responses',
        base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
        auth_scheme: 'bearer',
      },
    ],
  },
  {
    id: 'google_gemini',
    name: 'Google Gemini',
    provider_type: 'openai_compatible',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docs_url: 'https://ai.google.dev/gemini-api/docs/openai',
    description: 'Google AI Studio Gemini API，OpenAI Chat 兼容接口',
    popular_models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    supports_stream_usage: true,
    protocols: [{
      protocol: 'openai_chat',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      auth_scheme: 'bearer',
    }],
  },
  {
    id: 'groq',
    name: 'Groq',
    provider_type: 'openai_compatible',
    base_url: 'https://api.groq.com/openai/v1',
    docs_url: 'https://console.groq.com/docs/openai',
    description: 'GroqCloud 高速推理，原生支持 Chat 与 Responses',
    popular_models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://api.groq.com/openai/v1',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'openai_responses',
        base_url: 'https://api.groq.com/openai/v1',
        auth_scheme: 'bearer',
      },
    ],
  },
  {
    id: 'minimax_intl',
    name: 'MiniMax 国际',
    provider_type: 'openai_compatible',
    base_url: 'https://api.minimax.io/v1',
    docs_url: 'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
    description: 'MiniMax 国际站，同一 Key 原生支持 Chat 与 Messages',
    popular_models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://api.minimax.io/v1',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'anthropic_messages',
        base_url: 'https://api.minimax.io/anthropic/v1',
        auth_scheme: 'x_api_key',
        api_version: '2023-06-01',
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.x.ai/v1',
    docs_url: 'https://docs.x.ai/developers/model-capabilities/text/comparison',
    description: 'Grok 官方 API，原生支持 Chat 与 Responses',
    popular_models: ['grok-4.5', 'grok-4.3', 'grok-build-0.1'],
    supports_stream_usage: true,
    protocols: [
      {
        protocol: 'openai_chat',
        base_url: 'https://api.x.ai/v1',
        auth_scheme: 'bearer',
      },
      {
        protocol: 'openai_responses',
        base_url: 'https://api.x.ai/v1',
        auth_scheme: 'bearer',
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.mistral.ai/v1',
    docs_url: 'https://docs.mistral.ai/resources/migration-guides',
    description: 'Mistral 官方 API，OpenAI Chat 兼容接口',
    popular_models: ['mistral-large-2512', 'mistral-medium-3-5', 'mistral-small-2603'],
    supports_stream_usage: true,
    protocols: [{
      protocol: 'openai_chat',
      base_url: 'https://api.mistral.ai/v1',
      auth_scheme: 'bearer',
    }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    docs_url: 'https://platform.openai.com/docs/api-reference',
    description: 'OpenAI 官方 API，原生支持 Chat 与 Responses',
    popular_models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
    supports_stream_usage: true,
    protocols: [
      { protocol: 'openai_chat', base_url: 'https://api.openai.com/v1', auth_scheme: 'bearer' },
      { protocol: 'openai_responses', base_url: 'https://api.openai.com/v1', auth_scheme: 'bearer' },
    ],
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
    protocols: [{ protocol: 'openai_chat', base_url: 'https://api.siliconflow.cn/v1', auth_scheme: 'bearer' }],
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
    protocols: [{ protocol: 'openai_chat', base_url: 'https://api.moonshot.cn/v1', auth_scheme: 'bearer' }],
  },
  {
    id: 'zhipu',
    name: '智谱（中国）',
    provider_type: 'openai_compatible',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    docs_url: 'https://open.bigmodel.cn/dev/api/thirdparty-frame/openai-sdk',
    description: '智谱国内站 GLM 系列，OpenAI Chat 兼容接口',
    popular_models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
    supports_stream_usage: true,
    protocols: [{ protocol: 'openai_chat', base_url: 'https://open.bigmodel.cn/api/paas/v4', auth_scheme: 'bearer' }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    provider_type: 'openai_compatible',
    base_url: 'https://api.anthropic.com/v1',
    docs_url: 'https://docs.anthropic.com/en/api/messages',
    description: 'Claude 原生 Messages API',
    popular_models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    supports_stream_usage: true,
    protocols: [{
      protocol: 'anthropic_messages',
      base_url: 'https://api.anthropic.com/v1',
      auth_scheme: 'x_api_key',
      api_version: '2023-06-01',
    }],
  },
];

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

const DEFAULT_MODEL_DISCOVERY: ProviderModelDiscovery = {
  path: '/models', protocol: 'openai_chat', pagination: 'none',
};

/**
 * Preset discovery adapters. Most OpenAI-compatible providers document the
 * standard GET /models shape. Anthropic documents cursor pagination.
 * Presets without a documented exception use the standard adapter.
 */
const PROVIDER_MODEL_DISCOVERY: Partial<Record<string, ProviderModelDiscovery>> = {
  anthropic: { path: '/models', protocol: 'anthropic_messages', pagination: 'anthropic_cursor' },
  google_gemini: { path: '/models', protocol: 'openai_chat', pagination: 'page_token' },
  huawei_cloud_cn: {
    path: '/models', base_url: 'https://api.modelarts-maas.com/v1',
    protocol: 'openai_chat', pagination: 'none',
  },
};

export function providerModelDiscovery(presetId: string | null | undefined): ProviderModelDiscovery {
  return (presetId && PROVIDER_MODEL_DISCOVERY[presetId]) || DEFAULT_MODEL_DISCOVERY;
}

const PROVIDER_SHORT_CODES: Record<string, string> = {
  custom: 'custom', deepseek: 'ds', zai: 'zai', huawei_cloud_cn: 'hw',
  alibaba_cloud_intl: 'ali', byteplus_modelark: 'volc', google_gemini: 'gem',
  groq: 'groq', minimax_intl: 'mm', xai: 'xai', mistral: 'mis', openai: 'oai',
  siliconflow: 'sf', moonshot: 'kimi', zhipu: 'glm', anthropic: 'claude',
};

export function providerShortCode(presetId: string | null | undefined, channelName = 'channel'): string {
  const known = presetId ? PROVIDER_SHORT_CODES[presetId] : undefined;
  if (known) return known;
  const normalized = channelName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 6);
  return normalized || 'custom';
}

/**
 * Curated, provider-native model ids used by the model creation suggestions.
 * Keep this explicit: preset ordering is a UI concern and must not silently
 * change the 30-model baseline when a provider card is reordered.
 */
export const COMMON_MODEL_TEMPLATES = [
  'deepseek-v4-flash', 'deepseek-v4-pro',
  'glm-5.1', 'glm-5', 'glm-4.7',
  'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-flash',
  'seed-2-0-pro-260328', 'seed-2-0-lite-260428', 'seed-2-0-mini-260428',
  'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile',
  'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed',
  'grok-4.5', 'grok-4.3',
  'mistral-large-2512', 'mistral-medium-3-5', 'mistral-small-2603',
  'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'claude-opus-5', 'claude-sonnet-5',
] as const;

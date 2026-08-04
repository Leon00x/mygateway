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

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider_type: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    docs_url: 'https://api-docs.deepseek.com/zh-cn/',
    description: 'DeepSeek 官方 API，OpenAI Chat 兼容接口',
    popular_models: ['deepseek-chat', 'deepseek-reasoner'],
    supports_stream_usage: true,
    protocols: [{ protocol: 'openai_chat', base_url: 'https://api.deepseek.com/v1', auth_scheme: 'bearer' }],
  },
  {
    id: 'zai',
    name: 'Z.AI',
    provider_type: 'openai_compatible',
    base_url: 'https://api.z.ai/api/paas/v4',
    docs_url: 'https://docs.z.ai/guides/develop/openai/python',
    description: 'Z.AI 国际站 GLM 系列，OpenAI Chat 兼容接口',
    popular_models: ['glm-5.1', 'glm-4.7', 'glm-4.7-flash'],
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
    popular_models: ['deepseek-v4-flash', 'glm-5.2', 'deepseek-v3.2'],
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
    popular_models: ['seed-2-0-pro-260328', 'seed-2-0-lite-260428', 'deepseek-v4-flash-260425'],
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
    popular_models: ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'llama-3.3-70b-versatile'],
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
    popular_models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'],
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
    popular_models: ['grok-4.5', 'grok-4.5-latest', 'grok-build-latest'],
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
    popular_models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
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
    description: 'GPT-4o / GPT-4.1 / o3 等模型',
    popular_models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
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
    popular_models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
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

import { describe, expect, test } from 'vitest';
import { routeCandidatesForProtocol, type ChannelProtocol } from '../src/gateway/protocols.ts';
import type { CandidateRow } from '../src/db/models.ts';

function candidate(id: string, order: number, protocols: ChannelProtocol[]): CandidateRow {
  return {
    channel_model_id_pk: `cm-${id}`,
    channel_model_id: `provider-model-${id}`,
    public_model_alias: `alias-${id}`,
    sort_order: order,
    supports_stream_usage: 1,
    channel_id: id,
    channel_name: id,
    provider_type: 'openai_compatible',
    base_url: protocols[0]?.base_url ?? 'https://example.com/v1',
    protocols,
    api_key_ciphertext: 'ciphertext',
    api_key_iv: 'iv',
    api_key_version: 1,
  };
}

function protocol(protocol: ChannelProtocol['protocol']): ChannelProtocol {
  return {
    protocol,
    base_url: 'https://example.com/v1',
    auth_scheme: protocol === 'anthropic_messages' ? 'x_api_key' : 'bearer',
    api_version: protocol === 'anthropic_messages' ? '2023-06-01' : null,
  };
}

describe('protocol-aware routing', () => {
  test('prefers every native protocol candidate before translated candidates', () => {
    const routed = routeCandidatesForProtocol([
      candidate('preferred-chat-only', 0, [protocol('openai_chat')]),
      candidate('native-messages', 1, [protocol('anthropic_messages')]),
    ], 'anthropic_messages');

    expect(routed.map((item) => [item.channel_id, item.translated])).toEqual([
      ['native-messages', false],
      ['preferred-chat-only', true],
    ]);
  });

  test('uses the requested endpoint when one channel supports multiple protocols', () => {
    const routed = routeCandidatesForProtocol([
      candidate('multi', 0, [protocol('openai_chat'), protocol('anthropic_messages')]),
    ], 'anthropic_messages');

    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({
      upstreamProtocol: 'anthropic_messages',
      translated: false,
    });
  });

  test('does not translate Responses requests', () => {
    expect(routeCandidatesForProtocol([
      candidate('chat', 0, [protocol('openai_chat')]),
      candidate('messages', 1, [protocol('anthropic_messages')]),
    ], 'openai_responses')).toEqual([]);
  });
});

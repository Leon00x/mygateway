import type { CandidateRow } from '../db/models.ts';

export const GATEWAY_PROTOCOLS = [
  'openai_chat',
  'openai_responses',
  'anthropic_messages',
] as const;

export type GatewayProtocol = typeof GATEWAY_PROTOCOLS[number];
export type ProtocolAuthScheme = 'bearer' | 'x_api_key';

export interface ChannelProtocol {
  protocol: GatewayProtocol;
  base_url: string;
  auth_scheme: ProtocolAuthScheme;
  api_version: string | null;
}

export interface ProtocolRouteCandidate extends CandidateRow {
  upstreamProtocol: GatewayProtocol;
  protocolConfig: ChannelProtocol;
  translated: boolean;
}

export function isGatewayProtocol(value: unknown): value is GatewayProtocol {
  return typeof value === 'string' && GATEWAY_PROTOCOLS.includes(value as GatewayProtocol);
}

export function parseCandidateProtocols(value: unknown, legacyBaseUrl?: string): ChannelProtocol[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is ChannelProtocol => {
          if (!entry || typeof entry !== 'object') return false;
          const row = entry as Record<string, unknown>;
          return isGatewayProtocol(row.protocol)
            && typeof row.base_url === 'string'
            && (row.auth_scheme === 'bearer' || row.auth_scheme === 'x_api_key');
        });
      }
    } catch { /* legacy fallback below */ }
  }

  // Allows old local test doubles and a database between code deploy and migration
  // application to keep serving the protocol it supported before this migration.
  return legacyBaseUrl ? [{
    protocol: 'openai_chat',
    base_url: legacyBaseUrl,
    auth_scheme: 'bearer',
    api_version: null,
  }] : [];
}

function convertibleProtocol(requested: GatewayProtocol): GatewayProtocol | null {
  if (requested === 'openai_chat') return 'anthropic_messages';
  if (requested === 'anthropic_messages') return 'openai_chat';
  return null;
}

/** Native candidates always precede translated candidates; saved order is stable within each group. */
export function routeCandidatesForProtocol(
  candidates: CandidateRow[],
  requested: GatewayProtocol,
): ProtocolRouteCandidate[] {
  const native: ProtocolRouteCandidate[] = [];
  const translated: ProtocolRouteCandidate[] = [];
  const convertible = convertibleProtocol(requested);

  for (const candidate of candidates) {
    const exact = candidate.protocols.find((entry) => entry.protocol === requested);
    if (exact) {
      native.push({ ...candidate, upstreamProtocol: requested, protocolConfig: exact, translated: false });
      continue;
    }
    if (convertible) {
      const bridge = candidate.protocols.find((entry) => entry.protocol === convertible);
      if (bridge) {
        translated.push({
          ...candidate,
          upstreamProtocol: convertible,
          protocolConfig: bridge,
          translated: true,
        });
      }
    }
  }
  return [...native, ...translated];
}

export function protocolPath(protocol: GatewayProtocol): string {
  switch (protocol) {
    case 'openai_chat': return '/chat/completions';
    case 'openai_responses': return '/responses';
    case 'anthropic_messages': return '/messages';
  }
}

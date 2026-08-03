/**
 * Model resolver — resolves a model name from the request to candidates.
 */

import { resolveIdentifier, getCandidatesForModel, ModelIdentifierRow, CandidateRow } from '../db/models.ts';

export interface ResolvedModel {
  /** Whether this is a direct alias call (no fallback allowed). */
  direct: boolean;
  /** Ordered list of candidates to try. */
  candidates: CandidateRow[];
  /** The unified model ID for logging/usage. */
  unifiedModelId: string;
  /** The model card ID. */
  modelCardId: string;
}

/**
 * Resolve a model name from the request body to a list of candidates.
 */
export async function resolveModel(
  db: D1Database,
  modelName: string,
): Promise<ResolvedModel> {
  // 1. Look up in the global identifier registry
  const ident = await resolveIdentifier(db, modelName);
  if (!ident) {
    throw new ModelNotFoundError(modelName);
  }

  // 2. Unified model → all enabled candidates
  if (ident.identifier_type === 'unified') {
    const candidates = await getCandidatesForModel(db, ident.model_card_id);
    if (candidates.length === 0) {
      throw new ModelUnavailableError(modelName);
    }
    return {
      direct: false,
      candidates,
      unifiedModelId: modelName,
      modelCardId: ident.model_card_id,
    };
  }

  // 3. Alias → single candidate, no fallback
  if (ident.identifier_type === 'alias' && ident.channel_model_id) {
    // Fetch the single candidate
    const allCandidates = await getCandidatesForModel(db, ident.model_card_id);
    const candidate = allCandidates.find((c) => c.channel_model_id_pk === ident.channel_model_id);
    if (!candidate) {
      throw new ModelUnavailableError(modelName);
    }
    return {
      direct: true,
      candidates: [candidate],
      unifiedModelId: modelName,
      modelCardId: ident.model_card_id,
    };
  }

  throw new ModelUnavailableError(modelName);
}

export class ModelNotFoundError extends Error {
  constructor(public readonly model: string) {
    super(`Model '${model}' not found`);
    this.name = 'ModelNotFoundError';
  }
}

export class ModelUnavailableError extends Error {
  constructor(public readonly model: string) {
    super(`No active channel available for model '${model}'`);
    this.name = 'ModelUnavailableError';
  }
}

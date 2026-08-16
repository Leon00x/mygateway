/**
 * Token-to-cost conversion.
 *
 * Prices are stored per channel model as micro-USD per 1,000,000 tokens
 * (e.g. $3 per M input tokens → 3_000_000). cost_micros keeps integer math
 * so aggregated spend never drifts through floating point.
 */

export function computeCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputPriceMicrosPerMillion: number | null,
  outputPriceMicrosPerMillion: number | null,
  cacheTokens: number = 0,
  cacheInputPriceMicrosPerMillion: number | null = null,
): number {
  const inputPrice = inputPriceMicrosPerMillion ?? 0;
  const outputPrice = outputPriceMicrosPerMillion ?? 0;
  if (inputPrice === 0 && outputPrice === 0 && !cacheTokens) return 0;
  // Cache-hit tokens bill at the cache price when configured, otherwise at the
  // normal input price (conservative).
  const cachePrice = cacheInputPriceMicrosPerMillion ?? inputPrice;
  const nonCachedInput = Math.max(0, inputTokens - cacheTokens);
  const cost = (nonCachedInput * inputPrice + cacheTokens * cachePrice + outputTokens * outputPrice) / 1_000_000;
  return Math.round(cost);
}

/** Format an integer micro-USD amount as a short USD string. */
export function formatUsdMicros(costMicros: number): string {
  if (costMicros === 0) return '$0.000000';
  return `$${(costMicros / 1_000_000).toFixed(6)}`;
}

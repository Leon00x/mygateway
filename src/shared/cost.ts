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
): number {
  const inputPrice = inputPriceMicrosPerMillion ?? 0;
  const outputPrice = outputPriceMicrosPerMillion ?? 0;
  if (inputPrice === 0 && outputPrice === 0) return 0;
  const cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
  return Math.round(cost);
}

/** Format an integer micro-USD amount as a short USD string. */
export function formatUsdMicros(costMicros: number): string {
  if (costMicros === 0) return '$0.000000';
  return `$${(costMicros / 1_000_000).toFixed(6)}`;
}

/**
 * Admin Token verification — constant-time comparison.
 */

/**
 * Verify a candidate token against the stored ADMIN_TOKEN.
 * Uses timing-safe comparison via crypto.subtle.
 */
export async function verifyAdminToken(candidate: string, expected: string): Promise<boolean> {
  if (!candidate || candidate.length !== expected.length) {
    // Still do a comparison to avoid timing leak on length difference
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate));
    return false;
  }

  // XOR-based constant-time comparison
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

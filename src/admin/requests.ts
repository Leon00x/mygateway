/**
 * Admin recent-request log API.
 */

import { Env } from '../env.ts';
import { gatewayErrorResponse } from '../http/errors.ts';
import { listRequestLogs, type RequestLogStatus } from '../db/requests.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseStatus(value: string | null): RequestLogStatus | 'all' {
  if (value === null) return 'all';
  const statuses: RequestLogStatus[] = [
    'success', 'error', 'cancelled', 'rate_limited', 'budget_exceeded', 'not_allowed', 'expired',
  ];
  return (statuses as string[]).includes(value) ? value as RequestLogStatus : 'all';
}

/** GET /admin/api/requests?limit=50&key_id=&status= */
export async function handleRequests(
  request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return gatewayErrorResponse('invalid_request', 'Method not allowed', requestId);
  }
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const keyId = url.searchParams.get('key_id') ?? undefined;
  const status = parseStatus(url.searchParams.get('status'));

  const logs = await listRequestLogs(env.DB, { limit, keyId, status });
  return json({ logs });
}

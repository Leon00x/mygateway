import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type RequestRecord = {
  authorization?: string;
  body: Record<string, unknown> | null;
};

type Waiter = () => void;

export type FakeProvider = {
  baseUrl: string;
  close(): Promise<void>;
  count(scenario: string): number;
  lastRequest(scenario: string): RequestRecord | undefined;
  waitForCancellation(scenario: string, timeoutMs?: number): Promise<void>;
};

function completion(model: string) {
  return {
    id: 'chatcmpl-controlled-upstream',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'controlled upstream ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
}

function streamChunk(model: string, content: string) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-controlled-stream',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const requests = new Map<string, RequestRecord[]>();
  const cancelled = new Set<string>();
  const cancellationWaiters = new Map<string, Set<Waiter>>();

  const markCancelled = (scenario: string) => {
    cancelled.add(scenario);
    for (const resolve of cancellationWaiters.get(scenario) ?? []) resolve();
    cancellationWaiters.delete(scenario);
  };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const scenario = url.pathname.split('/').filter(Boolean)[0] ?? 'unknown';
    const body = await readJson(request);
    const records = requests.get(scenario) ?? [];
    records.push({ authorization: request.headers.authorization, body });
    requests.set(scenario, records);

    if (scenario === 'drop') {
      request.socket.destroy();
      return;
    }

    if (scenario === 'slow') {
      const timer = setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(completion(String(body?.model ?? 'fake-model'))));
      }, 5_000);
      response.on('close', () => clearTimeout(timer));
      return;
    }

    if (scenario === 'retry-429' || scenario === 'retry-503' || scenario === 'auth-401') {
      const status = scenario === 'retry-429' ? 429 : scenario === 'retry-503' ? 503 : 401;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: `controlled ${status}`, type: 'controlled_error' } }));
      return;
    }

    if (scenario === 'stream-cut') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(streamChunk(String(body?.model ?? 'fake-model'), 'first'));
      setTimeout(() => response.destroy(new Error('controlled stream interruption')), 40);
      return;
    }

    if (scenario === 'stream-live') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(streamChunk(String(body?.model ?? 'fake-model'), 'first'));
      const interval = setInterval(() => response.write(streamChunk(String(body?.model ?? 'fake-model'), 'next')), 50);
      response.on('close', () => {
        clearInterval(interval);
        if (!response.writableEnded) markCancelled(scenario);
      });
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(completion(String(body?.model ?? 'fake-model'))));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
    count: (scenario) => requests.get(scenario)?.length ?? 0,
    lastRequest: (scenario) => requests.get(scenario)?.at(-1),
    waitForCancellation: (scenario, timeoutMs = 3_000) => {
      if (cancelled.has(scenario)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cancellationWaiters.get(scenario)?.delete(onCancelled);
          reject(new Error(`Timed out waiting for '${scenario}' upstream cancellation`));
        }, timeoutMs);
        const onCancelled = () => {
          clearTimeout(timer);
          resolve();
        };
        const waiters = cancellationWaiters.get(scenario) ?? new Set<Waiter>();
        waiters.add(onCancelled);
        cancellationWaiters.set(scenario, waiters);
      });
    },
  };
}

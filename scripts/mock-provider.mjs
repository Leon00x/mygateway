// Dev-only mock provider for testing channel import without a real API key.
// Serves OpenAI-style GET /v1/models with models that exist in the price
// library (migrations/0009_model_prices.sql) so baseline prefill shows.
import { createServer } from 'node:http';

const MODELS = [
  { id: 'moonshot-v1-8k', object: 'model', owned_by: 'moonshot', display_name: 'Moonshot v1 8K' },
  { id: 'moonshot-v1-32k', object: 'model', owned_by: 'moonshot', display_name: 'Moonshot v1 32K' },
  { id: 'glm-4-plus', object: 'model', owned_by: 'zhipu', display_name: 'GLM-4-Plus' },
  { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek', display_name: 'DeepSeek Chat (V3)' },
];

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    console.log(`[mock] GET ${url.pathname} auth=${req.headers.authorization ?? '(none)'}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: MODELS }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      console.log(`[mock] POST /v1/chat/completions model=${parsed.model} stream=${parsed.stream ?? false}`);
      if (parsed.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","model":"' + parsed.model + '","choices":[{"index":0,"delta":{"role":"assistant","content":"你好"},"finish_reason":null}]}\n\n');
        res.write('data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","model":"' + parsed.model + '","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":2000,"prompt_tokens_details":{"cached_tokens":100},"prompt_cache_hit_tokens":100}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock', object: 'chat.completion', model: parsed.model,
          choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 100 }, prompt_cache_hit_tokens: 100 },
        }));
      }
    });
    return;
  }
  console.log(`[mock] ${req.method} ${url.pathname} → 404`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
}).listen(9999, '127.0.0.1', () => console.log('[mock] listening on http://127.0.0.1:9999'));

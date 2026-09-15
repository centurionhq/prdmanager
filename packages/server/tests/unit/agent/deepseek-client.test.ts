/**
 * `DeepSeekClient` contract test (WO-167, SDD-009 §Tests: "DeepSeekClient contra un servidor local que
 * emite chunks SSE estilo OpenAI"). No real network call — a throwaway `node:http` server on 127.0.0.1
 * emits an OpenAI-shaped `text/event-stream` response and this asserts both directions: the *request*
 * DeepSeekClient sends (headers, model, `stream: true`, tool schema translation) and the *events* it
 * derives from the response stream. The real DeepSeek network call is the separate manual verification
 * script required by ADR-006, never this suite.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createDeepSeekClient, createRedactingLogger, DEFAULT_DEEPSEEK_MODEL } from '../../../src/agent/deepseek-client.js';
import type { LlmEvent, LlmToolDefinition, StreamChatInput } from '../../../src/agent/llm-client.js';

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function sseChunk(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const FAKE_API_KEY = 'sk-fake-test-key-should-never-leak';

describe('DeepSeekClient contract (WO-167)', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | undefined;
  let respond: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

  beforeEach(async () => {
    lastRequest = undefined;
    server = createServer((req, res) => {
      void (async () => {
        const body = await readJsonBody(req);
        lastRequest = { headers: req.headers, body };
        await respond(req, res);
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const input: StreamChatInput = {
    messages: [
      { role: 'system', content: 'you are an agent' },
      { role: 'user', content: 'edit the doc' },
    ],
    tools: [{ name: 'read_document', description: 'reads it', parameters: { type: 'object', properties: {} } } satisfies LlmToolDefinition],
    maxTokens: 512,
  };

  test('shapes the request: Authorization bearer, model, stream=true, and tool schema translation', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseChunk(res, { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    await collect(client.streamChat(input));

    expect(lastRequest?.headers.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(lastRequest?.body.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(lastRequest?.body.stream).toBe(true);
    expect(lastRequest?.body.max_tokens).toBe(512);
    expect(lastRequest?.body.tools).toEqual([
      { type: 'function', function: { name: 'read_document', description: 'reads it', parameters: { type: 'object', properties: {} } } },
    ]);
    expect(lastRequest?.body.messages).toEqual([
      { role: 'system', content: 'you are an agent' },
      { role: 'user', content: 'edit the doc' },
    ]);
  });

  test('uses a custom model name from options', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: [DONE]\n\n');
      res.end();
    };
    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl, model: 'deepseek-custom' });
    await collect(client.streamChat(input));
    expect(lastRequest?.body.model).toBe('deepseek-custom');
  });

  test('streams token events from content deltas, then usage, then done', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseChunk(res, { choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] });
      sseChunk(res, { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] });
      sseChunk(res, {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    const events = await collect(client.streamChat(input));

    expect(events).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'usage', promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  test('accumulates a streamed tool call across chunks by index and emits it once complete', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseChunk(res, {
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_document', arguments: '{"pa' } }] }, finish_reason: null }],
      });
      sseChunk(res, {
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] }, finish_reason: 'tool_calls' }],
      });
      res.write('data: [DONE]\n\n');
      res.end();
    };

    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    const events = await collect(client.streamChat(input));

    expect(events).toEqual([
      { type: 'tool_call', toolCall: { id: 'call_1', name: 'read_document', argumentsJson: '{"path":"a"}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  test('maps any SDK/transport failure to a fixed llm_error event, never the raw error', async () => {
    respond = (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'upstream exploded', request_id: 'req_super_secret_123' } }));
    };

    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    const events = await collect(client.streamChat(input));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type === 'error') {
      expect(events[0].code).toBe('llm_error');
      expect(events[0].message).not.toContain('upstream exploded');
      expect(events[0].message).not.toContain('req_super_secret_123');
    }
  });

  test('the API key never appears in any emitted event, even on error', async () => {
    respond = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `bad key ${FAKE_API_KEY}` } }));
    };
    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    const events = await collect(client.streamChat(input));
    expect(JSON.stringify(events)).not.toContain(FAKE_API_KEY);
  });

  test('an already-aborted signal short-circuits without making the model finish', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseChunk(res, { choices: [{ index: 0, delta: { content: 'late' }, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    };
    const controller = new AbortController();
    controller.abort();
    const client = createDeepSeekClient({ apiKey: FAKE_API_KEY, baseUrl });
    const events = await collect(client.streamChat({ ...input, signal: controller.signal }));
    expect(events).toEqual([{ type: 'done', finishReason: 'aborted' }]);
  });
});

describe('createRedactingLogger (WO-167 / WO-175 secret-in-logs guard)', () => {
  test('replaces every occurrence of the secret in logged messages and args', () => {
    const lines: string[] = [];
    const base = {
      error: (msg: string, ...rest: unknown[]) => lines.push(JSON.stringify([msg, ...rest])),
      warn: (msg: string, ...rest: unknown[]) => lines.push(JSON.stringify([msg, ...rest])),
      info: (msg: string, ...rest: unknown[]) => lines.push(JSON.stringify([msg, ...rest])),
      debug: (msg: string, ...rest: unknown[]) => lines.push(JSON.stringify([msg, ...rest])),
    };
    const logger = createRedactingLogger(base, FAKE_API_KEY);
    logger.warn(`request failed using ${FAKE_API_KEY}`, { detail: `also has ${FAKE_API_KEY} inside` });

    const output = lines.join('\n');
    expect(output).not.toContain(FAKE_API_KEY);
    expect(output).toContain('[redacted]');
  });
});

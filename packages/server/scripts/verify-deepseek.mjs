#!/usr/bin/env node
/**
 * Manual DeepSeek verification (ADR-006's own task list: "Script manual de verificación de DeepSeek (GET
 * /models confirma deepseek-v4-flash y una llamada con tools en streaming), excluido de CI y sin imprimir
 * la clave"). Throwaway — not part of the build, not imported by any package, never run in CI or by the
 * automated test suite (which exclusively uses FakeLlmClient, per SDD-009).
 *
 * Run with:
 *   node --env-file=.env packages/server/scripts/verify-deepseek.mjs
 *
 * Prints only non-secret output: model ids, response text/structure, chunk counts. Never the API key,
 * never a full request/response object (which could carry the Authorization header), never `err.config`/
 * `err.request` from a thrown error (the openai SDK attaches request details to those).
 */
import OpenAI from 'openai';

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

if (!apiKey) {
  console.error('DEEPSEEK_API_KEY is not set (check .env) — aborting without making any request.');
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL, maxRetries: 1 });

async function verifyModelList() {
  console.log(`\n=== 1. GET /models — confirms "${model}" is a real, listed model ===`);
  const page = await client.models.list();
  const ids = page.data.map((m) => m.id);
  console.log(`received ${ids.length} model ids`);
  console.log(`"${model}" present: ${ids.includes(model)}`);
}

async function verifyPlainStreamingChat() {
  console.log(`\n=== 2. Plain streaming chat completion (model=${model}) ===`);
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
    max_tokens: 20,
  });
  let content = '';
  let chunkCount = 0;
  let finishReason;
  for await (const chunk of stream) {
    chunkCount += 1;
    content += chunk.choices[0]?.delta?.content ?? '';
    if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
  }
  console.log(`received ${chunkCount} stream chunks, finish_reason=${finishReason}`);
  console.log(`assembled content: ${JSON.stringify(content)}`);
}

async function verifyStreamingToolCall() {
  console.log('\n=== 3. Streaming chat completion with a tool-call-eligible request ===');
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [{ role: 'user', content: 'You must call the get_weather tool for the city of Lima. Do not answer in plain text — always call the tool.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Gets the current weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'] },
        },
      },
    ],
    max_tokens: 200,
  });

  const toolCallsByIndex = new Map();
  let finishReason;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(toolCallDelta.index) ?? { id: '', name: '', argumentsJson: '' };
      if (toolCallDelta.id) existing.id = toolCallDelta.id;
      if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name;
      if (toolCallDelta.function?.arguments) existing.argumentsJson += toolCallDelta.function.arguments;
      toolCallsByIndex.set(toolCallDelta.index, existing);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = [...toolCallsByIndex.values()];
  console.log(`finish_reason: ${finishReason}`);
  console.log(`tool call(s) received: ${JSON.stringify(toolCalls)}`);
  if (toolCalls.length === 0) {
    console.log('NOTE: no tool call was returned in this response — the model answered directly instead. See summary below.');
  }
  return toolCalls;
}

async function main() {
  await verifyModelList();
  await verifyPlainStreamingChat();
  const toolCalls = await verifyStreamingToolCall();

  console.log('\n=== Summary ===');
  console.log('Plain streaming chat: OK (see section 2 above).');
  console.log(toolCalls.length > 0 ? 'Streaming tool-call: OK — received a valid tool_call block.' : 'Streaming tool-call: model did not call the tool this time.');
  console.log('\nDone. No secret values were printed above.');
}

main().catch((err) => {
  // Deliberately only ever logs `.message` — never `err.config`/`err.request`/`err.response`, any of
  // which could carry the Authorization header or full request URL with query params.
  console.error('verification failed:', err?.message ?? String(err));
  process.exit(1);
});

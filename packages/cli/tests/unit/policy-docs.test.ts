import { describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { fetchPolicyDocs } from '../../src/remote/policy-docs.js';

describe('fetchPolicyDocs (WO-198)', () => {
  test('posts every sha in a single request and returns the parsed results', async () => {
    let receivedBody: unknown;
    const fetchImpl = (async (_url, init) => {
      receivedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ results: [{ sha: 'a'.repeat(40), evaluatedAt: new Date().toISOString(), documents: [] }] }), { status: 200 });
    }) as typeof fetch;

    const results = await fetchPolicyDocs('https://app.example.test', 'prj_0123456789abcdef', 't', ['a'.repeat(40), 'b'.repeat(40)], { fetchImpl });
    expect(receivedBody).toEqual({ shas: ['a'.repeat(40), 'b'.repeat(40)] });
    expect(results).toHaveLength(1);
  });

  test('throws CliError on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(fetchPolicyDocs('https://app.example.test', 'prj_0123456789abcdef', 't', ['a'.repeat(40)], { fetchImpl })).rejects.toThrow(CliError);
  });
});

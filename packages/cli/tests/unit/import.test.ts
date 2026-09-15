/**
 * `readLocalImportPayload`/`uploadImportPayload` (SDD-010 "Importador", WO-194): client-side pre-checks
 * and the upload itself, against a fake `/import` server.
 */
import { createServer, type Server } from 'node:http';
import { createFixtureRepo, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { afterEach, describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { readLocalImportPayload, uploadImportPayload } from '../../src/remote/import.js';

let root: string | undefined;

afterEach(() => {
  if (root) removeDir(root);
  root = undefined;
});

describe('readLocalImportPayload (WO-194)', () => {
  test('reads .prdm.yaml, every document and .prdm/baseline.json verbatim', async () => {
    root = createFixtureRepo({ withProjectFile: true });
    writeFiles(root, { '.prdm/baseline.json': '{"version":1,"docs":{},"governs":{}}' });

    const payload = await readLocalImportPayload(root);
    expect(payload.prdmYaml.length).toBeGreaterThan(0);
    expect(payload.documents.length).toBeGreaterThan(0);
    expect(payload.baselineJson).toBe('{"version":1,"docs":{},"governs":{}}');
  });

  test('omits baselineJson when there is no local baseline', async () => {
    root = createFixtureRepo({ withProjectFile: true });
    const payload = await readLocalImportPayload(root);
    expect(payload.baselineJson).toBeUndefined();
  });

  test('fails clearly when there is no local .prdm.yaml', async () => {
    root = makeTmpDir();
    await expect(readLocalImportPayload(root)).rejects.toThrow(/\.prdm\.yaml not found/);
  });

  test('fails when a document is invalid, before ever contacting the server', async () => {
    root = createFixtureRepo({ withProjectFile: true });
    writeFiles(root, { 'docs/prd/PRD-broken.md': '---\nid: PRD-999\ntype: PRD\n---\nno title field\n' });
    await expect(readLocalImportPayload(root)).rejects.toThrow(/invalid document/);
  });
});

describe('uploadImportPayload (WO-194)', () => {
  test('posts the payload and prints the returned summary', async () => {
    let receivedBody: unknown;
    let receivedAuth: string | undefined;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      receivedBody = JSON.parse(init!.body as string);
      receivedAuth = (init!.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ imported: 2, documents: [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md' }] }), { status: 200 });
    }) as typeof fetch;

    const lines: string[] = [];
    await uploadImportPayload(
      { prdmYaml: 'version: 1', documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: 'x' }] },
      { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef', token: 'prdm_pat_x' },
      { stdout: (l) => lines.push(l), fetchImpl },
    );

    expect(receivedAuth).toBe('Bearer prdm_pat_x');
    expect(receivedBody).toEqual({ schema_version: 1, prdmYaml: 'version: 1', documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: 'x' }] });
    expect(lines).toEqual(['imported 2 document(s) into prj_0123456789abcdef', '  PRD-001  docs/prd/PRD-001.md']);
  });

  test('throws CliError with the response body on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('project not empty', { status: 409 })) as typeof fetch;
    await expect(
      uploadImportPayload({ prdmYaml: 'x', documents: [] }, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef', token: 't' }, { stdout: () => undefined, fetchImpl }),
    ).rejects.toThrow(CliError);
  });

  test('never follows a redirect from the import endpoint (real HTTP server)', async () => {
    let targetHit = false;
    const server: Server = createServer((req, res) => {
      if (req.url?.includes('/import')) {
        res.writeHead(302, { location: '/evil' });
        res.end();
        return;
      }
      targetHit = true;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await expect(
        uploadImportPayload(
          { prdmYaml: 'x', documents: [] },
          { server: baseUrl, graphProjectId: 'prj_0123456789abcdef', token: 't' },
          { stdout: () => undefined },
        ),
      ).rejects.toThrow(CliError);
      expect(targetHit).toBe(false);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });
});


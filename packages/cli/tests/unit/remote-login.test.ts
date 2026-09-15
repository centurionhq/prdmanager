/**
 * `runLogin`/`runLogout` (SDD-010, WO-187): verifies against `GET /api/v1/me`, rejects a non-https
 * non-loopback server, and never follows a redirect from the verification endpoint.
 */
import { createServer, type Server } from 'node:http';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { loadCredentials } from '../../src/remote/credentials.js';
import { runLogin, runLogout } from '../../src/remote/login.js';

let xdgHome: string;
let env: NodeJS.ProcessEnv;
let lines: string[];

beforeEach(() => {
  xdgHome = makeTmpDir('prdm-xdg-');
  env = { XDG_CONFIG_HOME: xdgHome };
  lines = [];
});

afterEach(() => {
  removeDir(xdgHome);
});

function stdout(line: string): void {
  lines.push(line);
}

async function askHiddenReturning(value: string): Promise<() => Promise<string>> {
  return async () => value;
}

describe('runLogin (WO-187)', () => {
  test('stores the token once GET /api/v1/me responds 200', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ tokenKind: 'personal' }), { status: 200 })) as typeof fetch;
    await runLogin('https://app.example.test', 'prdm_pat_abc.def', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env });

    const stored = loadCredentials(env);
    expect(stored['https://app.example.test']).toEqual({ token: 'prdm_pat_abc.def' });
    expect(lines.some((l) => l.includes('logged in'))).toBe(true);
  });

  test('rejects a non-https, non-loopback server before ever calling fetch', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(runLogin('http://app.example.test', 'x', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env })).rejects.toThrow(CliError);
    expect(called).toBe(false);
  });

  test('rejects when the verification endpoint responds with anything other than 200', async () => {
    const fetchImpl = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    await expect(runLogin('https://app.example.test', 'bad-token', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env })).rejects.toThrow(CliError);
    expect(loadCredentials(env)).toEqual({});
  });

  test('a redirect response from the verification endpoint is rejected, never followed (real HTTP server)', async () => {
    let targetHit = false;
    const server: Server = createServer((req, res) => {
      if (req.url === '/api/v1/me') {
        res.writeHead(302, { location: '/evil' });
        res.end();
        return;
      }
      if (req.url === '/evil') {
        targetHit = true;
        res.writeHead(200);
        res.end('should never be reached');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await expect(runLogin(baseUrl, 'x', { stdout, askHidden: await askHiddenReturning(''), env })).rejects.toThrow(CliError);
      expect(targetHit).toBe(false);
      expect(loadCredentials(env)).toEqual({});
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects an empty token without ever calling fetch', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await expect(runLogin('https://app.example.test', '   ', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env })).rejects.toThrow(CliError);
    expect(called).toBe(false);
  });
});

describe('runLogout (WO-187)', () => {
  test('removes the credential for an explicit --server', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    await runLogin('https://app.example.test', 'x', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env });

    await runLogout('https://app.example.test', { stdout, env });
    expect(loadCredentials(env)).toEqual({});
  });

  test('defaults to the sole stored credential when --server is omitted', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    await runLogin('https://app.example.test', 'x', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env });

    await runLogout(undefined, { stdout, env });
    expect(loadCredentials(env)).toEqual({});
  });

  test('requires --server when more than one credential is stored', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    await runLogin('https://a.example.test', 'x', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env });
    await runLogin('https://b.example.test', 'y', { stdout, askHidden: await askHiddenReturning(''), fetchImpl, env });

    await expect(runLogout(undefined, { stdout, env })).rejects.toThrow(CliError);
  });
});

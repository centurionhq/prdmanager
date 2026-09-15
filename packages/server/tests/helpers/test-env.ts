import type { ServerEnv } from '../../src/env.js';

/** A fully-populated `ServerEnv` fixture for tests that don't care about the exact values (SDD-006, WO-091+). */
export function buildTestServerEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    nodeEnv: 'test',
    serverPort: 4601,
    publicUrl: 'https://app.example.test',
    betterAuthSecret: 'a'.repeat(32),
    databaseUrl: 'postgres://prdm_app:secret@127.0.0.1:55433/prdm',
    databaseMaxConnections: 20,
    trustedOrigins: ['https://app.example.test'],
    trustProxy: false,
    collabMaxPayloadBytes: 1_048_576,
    collabLimits: {
      maxRenderedBytes: 512 * 1024,
      maxEncodedStateBytes: 20 * 1024 * 1024,
      maxConnectionsPerUser: 20,
      maxConnectionsPerDocument: 50,
      maxUpdatesPerSecPerUser: 30,
      maxUpdatesPerSecPerDocument: 100,
    },
    smtp: { host: '127.0.0.1', port: 1025, secure: false, from: 'prdm <no-reply@example.test>' },
    agentQuotas: { dailyTokensPerOrg: 200_000, dailyTokensGlobal: 2_000_000, rpmPerUser: 10 },
    neo4j: { uri: 'neo4j://127.0.0.1:0', username: 'neo4j', password: 'unused-in-tests-that-never-touch-neo4j', database: 'neo4j' },
    ...overrides,
  };
}

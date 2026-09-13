import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/metrics', () => {
  test('returns the three success-metric sections', async () => {
    const res = await injectApi(ctx.app, '/api/metrics');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('agentHumanEfficiency');
    expect(body).toHaveProperty('systemIntegrity');
    expect(body).toHaveProperty('traceability');
  });
});

describe('GET /api/project', () => {
  test('returns id, name, folders, lifecycle and counts, with no authoring or connection fields', async () => {
    const res = await injectApi(ctx.app, '/api/project');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(ctx.config.project.id);
    expect(body.name).toBe(ctx.config.project.name);
    expect(body.folders).toEqual(ctx.config.folders);
    expect(body).toHaveProperty('lifecycle');
    expect(body).toHaveProperty('counts');
    expect(body).not.toHaveProperty('openDrafts');
    expect(body).not.toHaveProperty('draftableKinds');
    expect(body).not.toHaveProperty('neo4j');
    expect(JSON.stringify(body)).not.toMatch(/bolt|neo4j:\/\//);
  });
});

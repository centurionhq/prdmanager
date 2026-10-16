import { DatabaseBusyError, StatementTimedOutError } from '@prdm/core';
import { describe, expect, test } from 'vitest';
import { safeTool } from '../../src/shared.js';

const DRIVER_CAUSE = new Error('timeout exceeded when trying to connect to postgres://user:secret@db:5432');

describe('safeTool maps DB timeouts to explicit tool errors', () => {
  test('DatabaseBusyError becomes database_busy without leaking the driver cause', async () => {
    const tool = safeTool(async () => {
      throw new DatabaseBusyError('database busy', { cause: DRIVER_CAUSE });
    });
    const result = await tool({}, {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'database_busy' });
    const text = JSON.stringify(result);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('postgres://');
  });

  test('StatementTimedOutError becomes statement_timeout', async () => {
    const tool = safeTool(async () => {
      throw new StatementTimedOutError('statement timed out', { cause: new Error('canceling statement due to statement timeout') });
    });
    const result = await tool({}, {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'statement_timeout' });
    expect(JSON.stringify(result)).not.toContain('canceling');
  });

  // WO-647: el error crudo del driver (sin envolver) también tiene que surfear el vocabulario explícito.
  test('a raw pool connect timeout becomes database_busy without leaking the driver message', async () => {
    const tool = safeTool(async () => {
      throw DRIVER_CAUSE;
    });
    const result = await tool({}, {});
    expect(result.structuredContent).toMatchObject({ error: 'database_busy' });
    const text = JSON.stringify(result);
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('secret');
  });

  test('a raw pool connect timeout nested in .cause becomes database_busy', async () => {
    const tool = safeTool(async () => {
      throw new Error('wrapped', { cause: new Error('wrapped again', { cause: DRIVER_CAUSE }) });
    });
    const result = await tool({}, {});
    expect(result.structuredContent).toMatchObject({ error: 'database_busy' });
  });

  test('a raw SQLSTATE 57014 statement timeout becomes statement_timeout', async () => {
    const tool = safeTool(async () => {
      throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    });
    const result = await tool({}, {});
    expect(result.structuredContent).toMatchObject({ error: 'statement_timeout' });
    expect(JSON.stringify(result)).not.toContain('canceling');
  });

  test('any other error keeps the message-only shape', async () => {
    const tool = safeTool(async () => {
      throw new Error('boom');
    });
    const result = await tool({}, {});
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(result.structuredContent).toBeUndefined();
  });
});

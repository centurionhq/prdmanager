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

  test('any other error keeps the message-only shape', async () => {
    const tool = safeTool(async () => {
      throw new Error('boom');
    });
    const result = await tool({}, {});
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(result.structuredContent).toBeUndefined();
  });
});

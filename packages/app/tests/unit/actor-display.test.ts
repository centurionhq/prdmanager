/**
 * WO-695 (SDD-088 D4): what the audit table's «Quién» cell shows for an actor — the server's name when it sends one,
 * the `tipo:id` pair otherwise, and that pair always as the tooltip.
 */
import { describe, expect, it } from 'vitest';
import { actorDisplay } from '../../src/routes/audit/actor-display.js';

describe('actorDisplay (WO-695, SDD-088 D4)', () => {
  it('shows a person by name alone', () => {
    const shown = actorDisplay({ type: 'user', id: 'u1', name: 'Ana Pérez' });

    expect(shown.text).toBe('Ana Pérez');
    expect(shown.title).toBe('user:u1');
  });

  it('shows a token by name followed by its type', () => {
    const shown = actorDisplay({ type: 'token', id: 't1', name: 'ci-bot' });

    expect(shown.text).toBe('ci-bot (token)');
    expect(shown.title).toBe('token:t1');
  });

  it('falls back to tipo:id when the server sends no name', () => {
    const shown = actorDisplay({ type: 'user', id: 'u1' });

    expect(shown.text).toBe('user:u1');
    expect(shown.title).toBe('user:u1');
  });

  it('treats a null or empty name as no name', () => {
    expect(actorDisplay({ type: 'user', id: 'u1', name: null }).text).toBe('user:u1');
    expect(actorDisplay({ type: 'token', id: 't1', name: '' }).text).toBe('token:t1');
  });

  it('shows an unknown type with a name as nombre (tipo)', () => {
    const shown = actorDisplay({ type: 'service', id: 's1', name: 'scheduler' });

    expect(shown.text).toBe('scheduler (service)');
    expect(shown.title).toBe('service:s1');
  });
});

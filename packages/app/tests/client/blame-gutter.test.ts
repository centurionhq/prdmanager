import { describe, expect, test } from 'vitest';
import { describeAttribution, initial, relativeDate } from '../../src/collab/blame-gutter.js';

describe('initial', () => {
  test('uppercases the first character', () => {
    expect(initial('ana')).toBe('A');
  });
  test('falls back to "?" for an empty/blank name', () => {
    expect(initial('   ')).toBe('?');
  });
});

describe('relativeDate', () => {
  test('a timestamp seconds ago reads "ahora"', () => {
    expect(relativeDate(new Date(Date.now() - 5_000).toISOString())).toBe('ahora');
  });
  test('a timestamp minutes ago reads "hace N min"', () => {
    expect(relativeDate(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('hace 5 min');
  });
});

describe('describeAttribution', () => {
  test('a user attribution shows their initial and a short label', () => {
    const { short, full } = describeAttribution({ actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: new Date().toISOString() });
    expect(short).toBe('A');
    expect(full).toContain('ana');
  });

  test('an agent attribution reads "Agente (aceptado por X)" per SDD-008', () => {
    const { full } = describeAttribution({ actorKind: 'agent', userId: null, onBehalfOf: 'erin', agentId: 'agent:deepseek', receivedAt: new Date().toISOString() });
    expect(full).toMatch(/^Agente \(aceptado por erin\)/);
  });

  test('a system-on-behalf-of attribution mentions the user it acted for', () => {
    const { full } = describeAttribution({ actorKind: 'system', userId: null, onBehalfOf: 'dana', agentId: null, receivedAt: new Date().toISOString() });
    expect(full).toContain('dana');
  });
});

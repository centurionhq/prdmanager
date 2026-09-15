import { describe, expect, it } from 'vitest';
import {
  driftSummary,
  formatRelativeActivity,
  isValidSlug,
  lineLabel,
  roleLabel,
  slugify,
} from '../../../src/features/proyectos/lib';

describe('slugify', () => {
  it('lowercases, strips accents and joins words with hyphens', () => {
    expect(slugify('Data Report MS 2')).toBe('data-report-ms-2');
    expect(slugify('Añó Ñuñez')).toBe('ano-nunez');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Hola Mundo--  ')).toBe('hola-mundo');
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase letters, numbers and single hyphens', () => {
    expect(isValidSlug('data-report-ms-2')).toBe(true);
    expect(isValidSlug('a1')).toBe(true);
  });

  it('rejects uppercase, spaces, punctuation or empty strings', () => {
    expect(isValidSlug('Not Valid!!')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('doble--guion')).toBe(false);
    expect(isValidSlug('-empieza-con-guion')).toBe(false);
  });
});

describe('lineLabel', () => {
  it('reports only the furthest station when there is no andon', () => {
    expect(lineLabel({ furthestStation: 'ejecucion' })).toBe('Llega a Ejecución');
  });

  it('adds where the line stopped when there is an andon station', () => {
    expect(lineLabel({ furthestStation: 'cierre', andonStation: 'ejecucion' })).toBe(
      'Llega a Cierre, detenida en Ejecución',
    );
  });
});

describe('driftSummary', () => {
  const base = {
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
  };

  it('prioritizes errors, with correct pluralization', () => {
    expect(driftSummary({ ...base, driftErrors: 1 })).toEqual({ tone: 'error', label: '1 error' });
    expect(driftSummary({ ...base, driftErrors: 3 })).toEqual({ tone: 'error', label: '3 errores' });
  });

  it('falls back to warnings when there are no errors', () => {
    expect(driftSummary({ ...base, driftWarnings: 1 })).toEqual({ tone: 'warning', label: '1 aviso' });
    expect(driftSummary({ ...base, driftWarnings: 2 })).toEqual({ tone: 'warning', label: '2 avisos' });
  });

  it('reports awaiting the first CI report when nothing else applies', () => {
    expect(driftSummary({ ...base, awaitingFirstReport: true })).toEqual({
      tone: 'awaiting',
      label: 'Esperando primer reporte de CI',
    });
  });

  it('reports no drift otherwise', () => {
    expect(driftSummary(base)).toEqual({ tone: 'ok', label: 'Sin drift' });
  });
});

describe('roleLabel', () => {
  it('capitalizes the role', () => {
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('developer')).toBe('Developer');
  });
});

describe('formatRelativeActivity', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('shows minutes for very recent activity', () => {
    expect(formatRelativeActivity('2026-09-15T09:56:00.000Z', now)).toBe('hace 4 min');
  });

  it('shows hours within the same day', () => {
    expect(formatRelativeActivity('2026-09-15T04:00:00.000Z', now)).toBe('hace 6 h');
  });

  it('shows ayer for the previous day', () => {
    expect(formatRelativeActivity('2026-09-14T12:00:00.000Z', now)).toBe('ayer');
  });

  it('shows days for the rest of the week', () => {
    expect(formatRelativeActivity('2026-09-11T15:00:00.000Z', now)).toBe('hace 4 d');
  });

  it('falls back to a date beyond a week', () => {
    expect(formatRelativeActivity('2026-06-01T10:00:00.000Z', now)).toBe('01/06/2026');
  });
});

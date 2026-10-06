import { describe, expect, test } from 'vitest';
import { classifyDeliverable, normalizeForClassify, parseDeliverableDeclaration } from '../../src/workorders/deliverable.js';

describe('classifyDeliverable (SDD-093 D2)', () => {
  test.each([
    ['**WO-C (verificación, gate)** — arrancar y cerrar limpio', 'gate'],
    ['**WO-C (verificacion, gate)** — arrancar y cerrar limpio', 'gate'],
    ['**WO-C (VERIFICACIÓN, GATE)** — arrancar y cerrar limpio', 'gate'],
    ['Gate: correcciones del code review', 'code'],
    ['Revisar el flujo verificando que arranca y cierra limpio', 'code'],
    ['Verificar el gate de CI', 'code'],
    ['Migrar el gateway con verificación de rutas', 'code'],
  ] as const)('%s -> %s', (text, expected) => {
    expect(classifyDeliverable(text)).toBe(expected);
  });

  test('matches the plural stem verificaciones next to gate', () => {
    expect(classifyDeliverable('verificaciones del gate')).toBe('gate');
  });

  test('the stem must start at a word boundary', () => {
    expect(classifyDeliverable('reverificacion del gate')).toBe('code');
  });
});

describe('normalizeForClassify', () => {
  test('lowercases and strips accents', () => {
    expect(normalizeForClassify('VERIFICACIÓN Ñandú')).toBe('verificacion nandu');
  });
});

describe('parseDeliverableDeclaration', () => {
  test.each([
    ['  deliverable: gate ', 'gate'],
    ['Deliverable: CODE', 'code'],
    ['deliverable: otro', null],
    ['paths: a.ts', null],
    ['', null],
  ] as const)('%j -> %s', (line, expected) => {
    expect(parseDeliverableDeclaration(line)).toBe(expected);
  });
});

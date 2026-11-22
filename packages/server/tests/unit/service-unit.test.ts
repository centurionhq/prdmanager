import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveServiceName, SERVICE_NAME, SERVICE_TEMPLATE_DIR } from '../../scripts/service-unit.mjs';

describe('service-unit', () => {
  test('SERVICE_NAME coincide con el único *.service.template del repo', () => {
    const templates = readdirSync(SERVICE_TEMPLATE_DIR).filter((f) => f.endsWith('.service.template'));
    expect(templates).toHaveLength(1);
    expect(SERVICE_NAME).toBe(templates[0]!.replace(/\.template$/, ''));
    expect(SERVICE_NAME).toBe('prdm-server.service');
  });

  test('PRDM_SERVICE_NAME gana sobre el template', () => {
    expect(resolveServiceName({ env: { PRDM_SERVICE_NAME: ' otra.service ' } })).toBe('otra.service');
  });

  test('un override vacío se ignora', () => {
    expect(resolveServiceName({ env: { PRDM_SERVICE_NAME: '  ' } })).toBe(SERVICE_NAME);
  });

  test('falla con 0 templates y nombra el directorio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-none-'));
    expect(() => resolveServiceName({ env: {}, templateDir: dir })).toThrow(dir);
  });

  test('falla con 2 templates y nombra el directorio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-two-'));
    writeFileSync(join(dir, 'a.service.template'), '');
    writeFileSync(join(dir, 'b.service.template'), '');
    expect(() => resolveServiceName({ env: {}, templateDir: dir })).toThrow(dir);
  });
});

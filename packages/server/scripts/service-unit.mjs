/**
 * Fuente única del nombre de la unit systemd de `packages/server`: se deriva del nombre del único
 * `*.service.template` de `deploy/systemd`, con override `PRDM_SERVICE_NAME` para hosts con otra unit.
 */
import { readdirSync } from 'node:fs';
import process from 'node:process';
import { join } from 'node:path';
import { REPO_ROOT } from './repo-root.mjs';

export const SERVICE_TEMPLATE_DIR = join(REPO_ROOT, 'packages', 'server', 'deploy', 'systemd');
export const SERVICE_NAME_ENV = 'PRDM_SERVICE_NAME';

const TEMPLATE_SUFFIX = '.service.template';

/**
 * @param {{ env?: Record<string, string | undefined>, templateDir?: string }} [options]
 * @returns {string}
 */
export function resolveServiceName(options = {}) {
  const env = options.env ?? process.env;
  const override = env[SERVICE_NAME_ENV]?.trim();
  if (override) return override;

  const templateDir = options.templateDir ?? SERVICE_TEMPLATE_DIR;
  const templates = readdirSync(templateDir).filter((file) => file.endsWith(TEMPLATE_SUFFIX));
  if (templates.length !== 1) {
    throw new Error(
      `expected exactly one *${TEMPLATE_SUFFIX} in ${templateDir}, found ${templates.length}` +
        ` (${templates.join(', ') || 'none'}); set ${SERVICE_NAME_ENV} to override`,
    );
  }
  return `${templates[0].slice(0, -TEMPLATE_SUFFIX.length)}.service`;
}

export const SERVICE_NAME = resolveServiceName();

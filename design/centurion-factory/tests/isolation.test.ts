import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-007: this package lives outside the npm workspaces so it never touches governed root files.
describe('package isolation', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { workspaces: string[] };
  const ownManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    engines: { node: string };
  };

  it('is not part of the root npm workspaces', () => {
    expect(rootManifest.workspaces.some((pattern) => pattern.startsWith('design'))).toBe(false);
  });

  it('pins the same React, Vite and router versions as packages/app', () => {
    const app = JSON.parse(readFileSync(resolve(root, 'packages/app/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of ['react', 'react-dom', 'react-router']) {
      expect(ownManifest.dependencies[name]).toBe(app.dependencies[name]);
    }
    for (const name of ['vite', '@vitejs/plugin-react', 'jsdom', '@testing-library/react']) {
      expect(ownManifest.devDependencies[name]).toBe(app.devDependencies[name]);
    }
    expect(ownManifest.engines.node).toBe('>=24');
  });
});

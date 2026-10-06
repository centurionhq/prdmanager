/**
 * WO-568 (SDD-055/PRD-033 R4): the setup steps, as pure data.
 *
 * The assertion worth reading twice is the last one: the `.mcp.json` entry the screen shows is compared
 * against what `prdm link --mcp` actually writes (`planRemoteMcpJson`, imported from `@prdm/core` here in the
 * test, which `packages/app/src` may not do). A screen claiming to be the source of truth for setup must not
 * drift from the command it is documenting.
 */
import { describe, expect, it } from 'vitest';
import { planRemoteMcpJson } from '@prdm/core';
import { ASSISTANTS, MCP_ENTRY_SNIPPET, developerSetupSteps } from '../../src/routes/construir/developer-setup.js';

const SETUP = { orgSlug: 'acme', projectSlug: 'web', origin: 'https://centurion.example' };

describe('developerSetupSteps (WO-568)', () => {
  it('is three steps in the order the canvas sets, each one with something to do', () => {
    const steps = developerSetupSteps(SETUP);
    expect(steps.map((s) => s.id)).toEqual(['credencial', 'vincular', 'asistente']);
    for (const step of steps) expect(step.title.length).toBeGreaterThan(0);
  });

  it('builds the commands from this project and this server, never from a literal', () => {
    const [, vincular] = developerSetupSteps(SETUP);
    expect(vincular?.commands).toContain('prdm login --server https://centurion.example');
    expect(vincular?.commands).toContain('prdm link acme/web --server https://centurion.example --mcp');
  });

  it('installs the hook that makes every commit name its work order, in the same step and directory as the link', () => {
    const [, vincular] = developerSetupSteps(SETUP);
    expect(vincular?.commands).toContain('prdm hooks install');
  });

  it('follows the project it is looking at, so a copied command can never point at another one', () => {
    const [, vincular] = developerSetupSteps({ ...SETUP, orgSlug: 'otra', projectSlug: 'app' });
    expect(vincular?.commands).toContain('prdm link otra/app --server https://centurion.example --mcp');
    expect(vincular?.commands).not.toContain('acme/web');
  });

  it('offers only the assistants this repository actually documents (FB-034: Cursor is not one of them)', () => {
    expect(ASSISTANTS.map((a) => a.id)).toEqual(['claude-code', 'otro']);
    expect(ASSISTANTS.map((a) => a.label).join(' ')).not.toMatch(/cursor/i);
    // Claude Code needs nothing pasted: the link command already wrote the file it reads.
    expect(ASSISTANTS[0]?.needsSnippet).toBe(false);
    expect(ASSISTANTS[1]?.needsSnippet).toBe(true);
  });

  it('shows exactly the entry `prdm link --mcp` writes, so the screen cannot drift from the command', () => {
    const written = planRemoteMcpJson(null);
    expect(written).not.toBeNull();
    expect(JSON.parse(MCP_ENTRY_SNIPPET)).toEqual(JSON.parse(written as string));
  });
});

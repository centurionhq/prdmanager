import { describe, expect, it } from 'vitest';
import type { LineDiffOp } from '@prdm/collab';
import { diffFrontmatterKeys, extractTaskLines, summarizePublishDiff } from '../../src/lib/publish-review.js';

function op(type: LineDiffOp['type'], line: string): LineDiffOp {
  return { type, line };
}

describe('summarizePublishDiff', () => {
  it('collects only changed frontmatter lines, ignoring unchanged ones', () => {
    const ops: LineDiffOp[] = [
      op('equal', '---'),
      op('equal', 'id: SDD-011'),
      op('removed', 'status: "in_review"'),
      op('added', 'status: "approved"'),
      op('equal', '---'),
      op('equal', '# Title'),
    ];

    const summary = summarizePublishDiff(ops);

    expect(summary.frontmatter).toEqual([op('removed', 'status: "in_review"'), op('added', 'status: "approved"')]);
    expect(summary.tasks).toEqual([]);
    expect(summary.impactsPathsChanged).toBe(false);
  });

  it('flags impacts_paths changes inside the frontmatter block', () => {
    const ops: LineDiffOp[] = [op('equal', '---'), op('removed', 'impacts_paths: ["a/**"]'), op('added', 'impacts_paths: ["a/**", "b/**"]'), op('equal', '---')];

    expect(summarizePublishDiff(ops).impactsPathsChanged).toBe(true);
  });

  it('collects only new/removed task lines under "## Tareas", not other sections', () => {
    const ops: LineDiffOp[] = [
      op('equal', '---'),
      op('equal', '---'),
      op('equal', '## Contexto'),
      op('added', 'texto de contexto nuevo'),
      op('equal', '## Tareas'),
      op('equal', '- [ ] tarea vieja'),
      op('added', '- [ ] tarea nueva'),
      op('equal', '## Riesgos'),
      op('added', 'un riesgo nuevo'),
    ];

    const summary = summarizePublishDiff(ops);

    expect(summary.tasks).toEqual([op('added', '- [ ] tarea nueva')]);
    expect(summary.newTaskCount).toBe(1);
  });

  it('counts multiple new tasks', () => {
    const ops: LineDiffOp[] = [
      op('equal', '## Tareas'),
      op('added', '- [ ] uno'),
      op('added', '- [ ] dos'),
      op('removed', '- [ ] viejo'),
    ];

    expect(summarizePublishDiff(ops).newTaskCount).toBe(2);
  });
});

describe('extractTaskLines', () => {
  it('reads checklist items under "## Tareas" only', () => {
    const markdown = ['---', 'id: SDD-011', '---', '# Title', '## Tareas', '', '- [ ] one', '- [ ] two', '## Risks', '- not a task'].join('\n');

    expect(extractTaskLines(markdown)).toEqual(['- [ ] one', '- [ ] two']);
  });

  it('returns an empty array when there is no "## Tareas" section', () => {
    expect(extractTaskLines('# Title\n\nSome body.')).toEqual([]);
  });
});

describe('diffFrontmatterKeys', () => {
  it('reports only keys whose value actually changed', () => {
    const before = { status: 'in_review', architects: ['PRD-006'] };
    const after = { status: 'approved', architects: ['PRD-006'] };

    expect(diffFrontmatterKeys(before, after)).toEqual([{ key: 'status', before: 'in_review', after: 'approved' }]);
  });

  it('reports an added key as before: null', () => {
    const before = { status: 'approved' };
    const after = { status: 'approved', architects: ['PRD-007'] };

    expect(diffFrontmatterKeys(before, after)).toEqual([{ key: 'architects', before: null, after: 'PRD-007' }]);
  });

  it('reports a removed key as after: null', () => {
    expect(diffFrontmatterKeys({ tags: ['a'] }, {})).toEqual([{ key: 'tags', before: 'a', after: null }]);
  });
});

import { describe, expect, it } from 'vitest';
import { DOCUMENTS, getDocument } from '../../src/data/documents';
import { VERSIONS, versionsForDocument, latestVersion } from '../../src/data/versions';
import { COMMENT_THREADS, commentsForDocument } from '../../src/data/comments';
import { AGENT_PROPOSALS, proposalsForDocument } from '../../src/data/proposals';
import { VALIDATION_ISSUES, validationIssuesForDocument } from '../../src/data/validation';
import type { WorkflowState } from '../../src/data/types';

const WORKFLOW_STATES: readonly WorkflowState[] = ['draft', 'in_review', 'published', 'archived'];

function uniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe('documents', () => {
  it('has exactly 20 documents', () => {
    expect(DOCUMENTS).toHaveLength(20);
  });

  it('uses unique ids', () => {
    expect(uniqueIds(DOCUMENTS.map((d) => d.id))).toBe(true);
  });

  it('covers every workflow state', () => {
    for (const state of WORKFLOW_STATES) {
      expect(DOCUMENTS.some((d) => d.workflowState === state)).toBe(true);
    }
  });

  it('puts SDD-011 in_review with the canvas blocks', () => {
    const doc = getDocument('SDD-011');
    expect(doc?.workflowState).toBe<WorkflowState>('in_review');
    expect(doc?.blocks.map((b) => b.text)).toContain('Barra inferior mobile de 64 px con cinco destinos y Más.');
    const agentBlock = doc?.blocks.find((b) => b.author === 'agent');
    expect(agentBlock?.acceptedBy).toBe('ana-rios');
    const pendingTask = doc?.blocks.find((b) => b.text === 'Revisión visual manual en mobile');
    expect(pendingTask).toBeDefined();
  });

  it('gives every document at least one block', () => {
    for (const doc of DOCUMENTS) expect(doc.blocks.length).toBeGreaterThan(0);
  });
});

describe('versions', () => {
  it('gives every document 3-6 versions, except the documented SDD-011 exception (7)', () => {
    for (const doc of DOCUMENTS) {
      const count = versionsForDocument(doc.id).length;
      if (doc.id === 'SDD-011') expect(count).toBe(7);
      else {
        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(6);
      }
    }
  });

  it('resolves every version to an existing document', () => {
    for (const version of VERSIONS) expect(getDocument(version.documentId)).toBeDefined();
  });

  it('numbers versions sequentially from 1 per document', () => {
    for (const doc of DOCUMENTS) {
      const numbers = versionsForDocument(doc.id).map((v) => v.versionNo).sort((a, b) => a - b);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it('reports SDD-011 at the latest version 7', () => {
    expect(latestVersion('SDD-011')?.versionNo).toBe(7);
  });
});

describe('comment threads', () => {
  it('resolves every thread to an existing document', () => {
    for (const thread of COMMENT_THREADS) expect(getDocument(thread.documentId)).toBeDefined();
  });

  it('gives every document 0-4 threads', () => {
    for (const doc of DOCUMENTS) {
      expect(commentsForDocument(doc.id).length).toBeLessThanOrEqual(4);
    }
  });

  it('covers both open and resolved threads', () => {
    expect(COMMENT_THREADS.some((t) => t.status === 'open')).toBe(true);
    expect(COMMENT_THREADS.some((t) => t.status === 'resolved')).toBe(true);
  });

  it('gives SDD-011 exactly 2 open threads', () => {
    const threads = commentsForDocument('SDD-011');
    expect(threads.filter((t) => t.status === 'open')).toHaveLength(2);
  });

  it('gives resolved threads a resolvedBy', () => {
    for (const thread of COMMENT_THREADS.filter((t) => t.status === 'resolved')) {
      expect(thread.resolvedBy).toBeTruthy();
    }
  });
});

describe('agent proposals', () => {
  it('has exactly 3 proposals covering pending, accepted and stale', () => {
    expect(AGENT_PROPOSALS).toHaveLength(3);
    expect(AGENT_PROPOSALS.map((p) => p.status).sort()).toEqual(['accepted', 'pending', 'stale']);
  });

  it('resolves every proposal to an existing document', () => {
    for (const proposal of AGENT_PROPOSALS) expect(getDocument(proposal.documentId)).toBeDefined();
  });

  it('puts the pending proposal on SDD-011 replacing the mobile review task', () => {
    const pending = proposalsForDocument('SDD-011').find((p) => p.status === 'pending');
    expect(pending?.summary).toBe('Agregar la tarea de capturas a 375 px');
    expect(pending?.edits[0]?.expectedText).toBe('- [ ] Revisión visual manual en mobile');
  });
});

describe('validation issues', () => {
  it('gives FR-003 exactly 2 errors', () => {
    const issues = validationIssuesForDocument('FR-003');
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(2);
  });

  it('resolves every issue to an existing document', () => {
    for (const issue of VALIDATION_ISSUES) expect(getDocument(issue.documentId)).toBeDefined();
  });

  it('does not put errors on documents other than FR-003', () => {
    for (const issue of VALIDATION_ISSUES.filter((i) => i.documentId !== 'FR-003')) {
      expect(issue.severity).toBe('warning');
    }
  });
});

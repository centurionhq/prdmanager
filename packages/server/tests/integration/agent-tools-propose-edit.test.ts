/**
 * WO-173 — `propose_edit`: resolves each edit's `expectedText` occurrence in the live body to a
 * `Y.RelativePosition`, rejects overlapping edits and forbidden frontmatter changes, and stores a
 * `pending` `agent_proposals` row. Against a real Postgres (the anchors are real Yjs relative positions
 * resolved against a real `Y.Doc` reconstructed from `doc_updates`).
 */
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { decodeUpdateRanges, resolveCommentAnchor, type EncodedCommentAnchor } from '@prdm/collab';
import { createOrganizationFixture, createProjectFixture, createUserFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { AgentToolError, AgentToolPermissionError, type AgentToolContext } from '../../src/agent/tools/index.js';
import { proposeEditTool, type ResolvedProposalEdit } from '../../src/agent/tools/propose-edit.js';
import { reconstructLiveYDoc } from '../../src/collab/reconstruct-ydoc.js';

describe('propose_edit tool (SDD-009 §Diseño, WO-173)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    neo4j = Neo4jGraphDatabase.connect(testConfig(tmpRoot).neo4j);
    await neo4j.verify();
    await neo4j.migrate();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  async function insertDocumentFixture(
    pool: Pool,
    overrides: { orgId: string; projectId: string; origin?: string; workflowState?: string },
  ): Promise<{ id: string; docId: string }> {
    const id = randomUUID();
    const docId = `PRD-${id.slice(0, 8)}`;
    await pool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
       VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', $5, $6)`,
      [id, overrides.orgId, overrides.projectId, docId, overrides.origin ?? 'collab', overrides.workflowState ?? 'draft'],
    );
    return { id, docId };
  }

  async function seedLiveDocument(orgId: string, documentId: string, body: string, fields: Record<string, string> = {}): Promise<void> {
    const doc = new Y.Doc({ gc: false });
    doc.getText('body').insert(0, body);
    const fm = doc.getMap('fm');
    for (const [key, value] of Object.entries(fields)) fm.set(key, value);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, 1, 'system', $3, $4, $5)`,
      [orgId, documentId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  async function setup(body: string, fields: Record<string, string> = {}, documentOverrides: { origin?: string; workflowState?: string } = {}) {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const { id: documentId, docId } = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id, ...documentOverrides });
    await seedLiveDocument(org.id, documentId, body, fields);
    const user = await createUserFixture(pg);
    const projectRecord = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(project.id);
    if (!projectRecord) throw new Error('fixture project not found');
    const document = await createTenantDb(pg.appPool).forOrg(org.id).forProject(project.id).documents.findByDocId(docId);
    if (!document) throw new Error('fixture document not found');

    const conversation = await createTenantDb(pg.appPool).forOrg(org.id).agent.conversations.create({ documentId, ownerId: user.id });

    const ctx: AgentToolContext = {
      pool: pg.appPool,
      neo4j,
      orgId: org.id,
      project: projectRecord,
      document: document.document,
      conversationId: conversation.id,
      requestedBy: user.id,
      loadSubject: async () => ({ orgRole: 'owner' }),
    };
    return { org, project: projectRecord, documentId, conversation, ctx };
  }

  test('resolves a single edit to a real Y.RelativePosition anchor and stores a pending proposal', async () => {
    const { org, documentId, conversation, ctx } = await setup('## Summary\nThis feature improves onboarding.\n');

    const result = (await proposeEditTool.execute(ctx, {
      summary: 'Tighten the summary',
      edits: [{ expectedText: 'improves onboarding', replacement: 'streamlines onboarding' }],
    })) as { proposalId: string; status: string; editCount: number };

    expect(result.status).toBe('pending');
    expect(result.editCount).toBe(1);

    const proposal = await createTenantDb(pg.appPool).forOrg(org.id).agent.proposals.findById(result.proposalId);
    expect(proposal?.status).toBe('pending');
    expect(proposal?.conversationId).toBe(conversation.id);
    expect(proposal?.documentId).toBe(documentId);
    const edits = proposal!.edits as ResolvedProposalEdit[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.expectedText).toBe('improves onboarding');

    // The stored anchor really does resolve, via the real Yjs mechanism, back to the exact quoted text.
    const { ydoc } = await reconstructLiveYDoc(pg.appPool, org.id, documentId);
    const anchor: EncodedCommentAnchor = { start: Buffer.from(edits[0]!.anchorStart, 'base64'), end: Buffer.from(edits[0]!.anchorEnd, 'base64') };
    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBe('improves onboarding');
  });

  test('resolves multiple non-overlapping edits independently', async () => {
    const { ctx } = await setup('Alpha section.\n\nBeta section.\n');
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'Rename both sections',
      edits: [
        { expectedText: 'Alpha section', replacement: 'Alpha part' },
        { expectedText: 'Beta section', replacement: 'Beta part' },
      ],
    })) as { editCount: number };
    expect(result.editCount).toBe(2);
  });

  test('targets a later occurrence via the occurrence field', async () => {
    const { org, documentId, ctx } = await setup('repeat repeat repeat');
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'fix the second one',
      edits: [{ expectedText: 'repeat', occurrence: 1, replacement: 'REPLACED' }],
    })) as { proposalId: string };

    const proposal = await createTenantDb(pg.appPool).forOrg(org.id).agent.proposals.findById(result.proposalId);
    expect(proposal?.status).toBe('pending');
    const [edit] = proposal!.edits as ResolvedProposalEdit[];
    expect(edit!.occurrence).toBe(1);

    const { ydoc } = await reconstructLiveYDoc(pg.appPool, org.id, documentId);
    const anchor: EncodedCommentAnchor = { start: Buffer.from(edit!.anchorStart, 'base64'), end: Buffer.from(edit!.anchorEnd, 'base64') };
    // "repeat repeat repeat": occurrence 1 (0-indexed) is the second "repeat", at [7, 13).
    expect(resolveCommentAnchor(ydoc, anchor).range).toEqual({ from: 7, to: 13 });
  });

  test('WO-535 (SDD-049/FB-027): rejects an expectedText that is only a newline, before it ever reaches findOccurrenceRange', async () => {
    // The exact shape observed in a real session: a whitespace anchor with a large replacement landed
    // glued to an existing heading and orphaned the document's own original sections below it.
    const { ctx } = await setup('## Resumen\n\n## Requisitos\n\n## Fuera de alcance\n');
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: '\n', replacement: '## Resumen\n\nfull new body...' }] }),
    ).rejects.toMatchObject({ code: 'blank_expected_text' });
  });

  test('WO-535: rejects an expectedText that is only spaces, the same way', async () => {
    const { ctx } = await setup('some real body text');
    await expect(proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: '   ', replacement: 'y' }] })).rejects.toMatchObject({
      code: 'blank_expected_text',
    });
  });

  test('WO-535: a real, non-blank quote is unaffected by the new check', async () => {
    const { ctx } = await setup('## Resumen\n\nEsto es un resumen real.\n');
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'x',
      edits: [{ expectedText: '## Resumen', replacement: '## Resumen actualizado' }],
    })) as { editCount: number };
    expect(result.editCount).toBe(1);
  });

  test('rejects when expectedText does not appear in the current body', async () => {
    const { ctx } = await setup('nothing relevant here');
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'not present anywhere', replacement: 'y' }] }),
    ).rejects.toMatchObject({ code: 'text_not_found' });
  });

  test('rejects when the requested occurrence does not exist', async () => {
    const { ctx } = await setup('only one match here');
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'only one match', occurrence: 1, replacement: 'y' }] }),
    ).rejects.toMatchObject({ code: 'text_not_found' });
  });

  test('rejects two edits whose resolved ranges overlap', async () => {
    const { ctx } = await setup('the quick brown fox jumps');
    await expect(
      proposeEditTool.execute(ctx, {
        summary: 'x',
        edits: [
          { expectedText: 'quick brown', replacement: 'a' },
          { expectedText: 'brown fox', replacement: 'b' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'overlapping_edits' });
  });

  test('rejects a frontmatter change to a lifecycle-managed forbidden field', async () => {
    const { ctx } = await setup('body text', { status: 'approved' });
    await expect(
      proposeEditTool.execute(ctx, { summary: 'sneaky', edits: [{ expectedText: 'body text', replacement: 'body text!' }], fields: { set: { status: 'closed' } } }),
    ).rejects.toMatchObject({ code: 'forbidden_fields' });
  });

  test('rejects an invalid (non snake_case) field key before ever touching the database', async () => {
    const { ctx } = await setup('body text');
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'body text', replacement: 'y' }], fields: { set: { 'not a valid key': 'z' } } }),
    ).rejects.toMatchObject({ code: 'invalid_field_key' });
  });

  test('allows a non-forbidden frontmatter field change alongside a text edit', async () => {
    const { ctx } = await setup('body text', { owner: 'alice' });
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'reassign owner',
      edits: [{ expectedText: 'body text', replacement: 'body text!' }],
      fields: { set: { owner: 'bob' } },
    })) as { editCount: number };
    expect(result.editCount).toBe(1);
  });

  test('WO-537/WO-539 (SDD-050/FB-028): tags set as a real array is accepted and stored as an array', async () => {
    const { org, documentId, ctx } = await setup('body text');
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'tag it',
      edits: [{ expectedText: 'body text', replacement: 'body text!' }],
      fields: { set: { tags: ['agente', 'ux'] } },
    })) as { proposalId: string };

    const proposal = await createTenantDb(pg.appPool).forOrg(org.id).agent.proposals.findById(result.proposalId);
    expect(proposal?.fieldsSet).toEqual({ tags: ['agente', 'ux'] });
  });

  test('WO-538/WO-539: rejects tags sent as a comma-separated string, with an actionable error', async () => {
    const { ctx } = await setup('body text');
    await expect(
      proposeEditTool.execute(ctx, {
        summary: 'tag it wrong',
        edits: [{ expectedText: 'body text', replacement: 'body text!' }],
        fields: { set: { tags: 'agente, ux' } },
      }),
    ).rejects.toMatchObject({ code: 'field_type_mismatch', message: expect.stringContaining('tags') });
  });

  test('WO-538: rejects implements (an id-list field, not just tags) sent as a string, the same way', async () => {
    const { ctx } = await setup('body text');
    await expect(
      proposeEditTool.execute(ctx, {
        summary: 'x',
        edits: [{ expectedText: 'body text', replacement: 'y' }],
        fields: { set: { implements: 'SDD-001' } },
      }),
    ).rejects.toMatchObject({ code: 'field_type_mismatch' });
  });

  test('WO-539: a scalar field (title) as a string is unaffected by the new list-field check', async () => {
    const { ctx } = await setup('body text');
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'rename',
      edits: [{ expectedText: 'body text', replacement: 'body text!' }],
      fields: { set: { title: 'New title' } },
    })) as { editCount: number };
    expect(result.editCount).toBe(1);
  });

  test('denies a caller without use_agent permission', async () => {
    const { ctx } = await setup('body text');
    await expect(
      proposeEditTool.execute({ ...ctx, loadSubject: async () => ({}) }, { summary: 'x', edits: [{ expectedText: 'body text', replacement: 'y' }] }),
    ).rejects.toBeInstanceOf(AgentToolPermissionError);
  });

  test('still allows proposing an edit against an ordinary in_review document (WO-228 happy path)', async () => {
    const { ctx } = await setup('body text', {}, { workflowState: 'in_review' });
    const result = (await proposeEditTool.execute(ctx, {
      summary: 'x',
      edits: [{ expectedText: 'body text', replacement: 'y' }],
    })) as { editCount: number };
    expect(result.editCount).toBe(1);
  });

  test('rejects proposing an edit against an archived document (WO-228)', async () => {
    const { ctx } = await setup('body text', {}, { workflowState: 'archived' });
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'body text', replacement: 'y' }] }),
    ).rejects.toMatchObject({ code: 'document_read_only' });
  });

  test('rejects proposing an edit against a generated-origin document (WO-228)', async () => {
    const { ctx } = await setup('body text', {}, { origin: 'generated' });
    await expect(
      proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'body text', replacement: 'y' }] }),
    ).rejects.toMatchObject({ code: 'document_read_only' });
  });

  test('AgentToolError instances carry their own machine-readable code', async () => {
    const { ctx } = await setup('body text');
    try {
      await proposeEditTool.execute(ctx, { summary: 'x', edits: [{ expectedText: 'missing', replacement: 'y' }] });
      expect.unreachable('expected proposeEditTool to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe('text_not_found');
    }
  });
});

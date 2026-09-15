/**
 * Shared `ProjectEngine` contract suite (SDD-007 "Tests": "suite de contrato de ProjectEngine ejecutada
 * contra Engine y PgProjectEngine"; WO-135). One function, instantiated once against a local,
 * disk-backed `Engine` fixture (`packages/core/tests`) and once against a Postgres/Neo4j-backed
 * `PgProjectEngine` (`packages/server/tests`) — same test bodies, same assertions, so a behavioral
 * divergence between the two `ProjectEngine` implementations fails in exactly one place.
 *
 * Exercises the domain functions every `ProjectEngine` caller actually depends on
 * (`submitFeedback`, `generateWorkOrders`, `claimWorkOrder`, `completeWorkOrder`) plus `scan`,
 * `refresh`/`inspect` and `acknowledge` directly: id allocation never collides with `scan().ids` (incl.
 * under concurrency), `generateWorkOrders` is idempotent, a full claim -> complete flow resolves a real
 * commit, and `acknowledge` clears a drift issue `refresh()` raised.
 *
 * Deliberately narrower than SDD-007's full description in one place: "refresh reflects a code report"
 * is only meaningfully identical across both engines for the *document-level* drift `detectDrift`
 * already computes locally today (a changed blueprint's content going out of sync with a completed work
 * order) — `PgProjectEngine`'s own *code-level* governance (real `CodeRefState`s from a CI report) is
 * SDD-010's job and still deliberately empty on the Postgres side (see WO-134's own doc comments), so a
 * code-governed scenario is not yet actually identical across implementations and is not asserted here.
 */
import { claimWorkOrder, completeWorkOrder, generateWorkOrders, submitFeedback, type ProjectEngine } from '@prdm/core';
import { describe, expect, test } from 'vitest';

export interface ProjectEngineContractHarness {
  engine: ProjectEngine;
  /**
   * Writes (or, called again with the same document id, overwrites) a document directly into whatever
   * storage this `ProjectEngine` implementation actually uses, bypassing the engine's own
   * `transaction()`/`createDocument` path entirely — simulating a document that is simply already there
   * (e.g. previously published), the same way this repo's own fixtures/hand-seeded rows already do.
   * `relPath` must match the default folder layout (`docs/<kind-folder>/...`, e.g. `docs/sdd/SDD-001.md`)
   * both `Engine`'s and `PgProjectEngine`'s default settings agree on.
   */
  seedDocument(relPath: string, content: string): Promise<void>;
  /** Creates (or simulates) a resolvable commit whose `Refs: <id>` trailer references `id`, returning
   * the sha `engine.transaction((ops) => ops.readCommit(sha))` must then resolve — git-backed for
   * `Engine`, a `commits` row with `trust: 'baseline'` for `PgProjectEngine`. */
  commitReferencing(id: string): Promise<string>;
  cleanup(): Promise<void>;
}

const FEATURE_PATH = 'docs/fr/FR-001-example.md';
const FEATURE_DOC = `---
id: FR-001
type: FR
title: "Example feature"
---

## Solicitud
`;

const BLUEPRINT_PATH = 'docs/sdd/SDD-001-example.md';
// `## Tareas`/`## Tasks` is deliberately excluded from a document's content hash (ADR-002 D9, `parser/
// frontmatter.ts`'s `stripTasksSection`) since checking off/adding tasks must never itself count as a
// design change; the task list here is intentionally fixed across both fixture revisions so
// `generateWorkOrders`' idempotency and the "blueprint content actually changed" scenario stay clearly
// separated. `context` is what actually changes between revisions.
const blueprintDoc = (context: string): string => `---
id: SDD-001
type: SDD
title: "Example blueprint"
architects: ["FR-001"]
impacts_paths: ["src/example.ts"]
---

## Contexto

${context}

## Tareas

- [ ] Implement the thing
`;

function feedbackDoc(id: string, title: string): string {
  return `---
id: ${id}
type: FB
title: "${title}"
status: new
source: other
informs: []
---

## Detalle

${title}
`;
}

async function seedFeatureAndBlueprint(harness: ProjectEngineContractHarness, context = 'Example.'): Promise<void> {
  await harness.seedDocument(FEATURE_PATH, FEATURE_DOC);
  await harness.seedDocument(BLUEPRINT_PATH, blueprintDoc(context));
}

export function runProjectEngineContractTests(makeHarness: () => Promise<ProjectEngineContractHarness>): void {
  describe('ProjectEngine contract (WO-135)', () => {
    async function withHarness<T>(fn: (harness: ProjectEngineContractHarness) => Promise<T>): Promise<T> {
      const harness = await makeHarness();
      try {
        return await fn(harness);
      } finally {
        await harness.cleanup();
      }
    }

    test('submitFeedback never allocates an id that scan().ids already reports', () =>
      withHarness(async ({ engine, seedDocument }) => {
        await seedDocument('docs/feedback/FB-001-existing.md', feedbackDoc('FB-001', 'Existing feedback'));

        const result = await submitFeedback(engine, { text: 'Please add dark mode support', source: 'app' });

        expect(result.id).not.toBe('FB-001');
        const scan = await engine.scan();
        expect(scan.ids).toContain('FB-001');
        expect(scan.ids).toContain(result.id);
      }));

    test('concurrent submitFeedback calls never produce duplicate ids', () =>
      withHarness(async ({ engine }) => {
        const results = await Promise.all(
          Array.from({ length: 5 }, (_, i) => submitFeedback(engine, { text: `Feedback number ${i} about the product`, source: 'app' })),
        );
        expect(new Set(results.map((r) => r.id)).size).toBe(5);
      }));

    test('generateWorkOrders is idempotent', () =>
      withHarness(async (harness) => {
        await seedFeatureAndBlueprint(harness);

        const first = await generateWorkOrders(harness.engine, 'SDD-001');
        expect(first.created).toHaveLength(1);
        expect(first.skipped).toBe(0);

        const second = await generateWorkOrders(harness.engine, 'SDD-001');
        expect(second.created).toHaveLength(0);
        expect(second.skipped).toBe(1);

        const scan = await harness.engine.scan();
        expect(scan.docs.filter((d) => d.node.label === 'WorkOrder')).toHaveLength(1);
      }));

    test('claim -> complete a work order with a real commit resolves it', () =>
      withHarness(async (harness) => {
        await seedFeatureAndBlueprint(harness);
        const { created } = await generateWorkOrders(harness.engine, 'SDD-001');
        const woId = created[0]!.id;

        await claimWorkOrder(harness.engine, woId, 'agent:contract-test');
        const sha = await harness.commitReferencing(woId);
        const result = await completeWorkOrder(harness.engine, woId, { commitSha: sha });

        expect(result.status).toBe('done');
        expect(result.resolvedBy).toContain(sha);
        const scan = await harness.engine.scan();
        expect(scan.docs.find((d) => d.node.id === woId)?.node.status).toBe('done');
      }));

    test('acknowledge clears a work_order_out_of_sync issue raised by refresh() after the blueprint changes', () =>
      withHarness(async (harness) => {
        await seedFeatureAndBlueprint(harness);
        const { created } = await generateWorkOrders(harness.engine, 'SDD-001');
        const woId = created[0]!.id;
        await claimWorkOrder(harness.engine, woId, 'agent:contract-test');
        const sha = await harness.commitReferencing(woId);
        await completeWorkOrder(harness.engine, woId, { commitSha: sha });
        await harness.engine.refresh(); // establishes the baseline hash completeWorkOrder recorded.

        // The blueprint's design changes (new context -> new content hash) without a new work order.
        await harness.seedDocument(BLUEPRINT_PATH, blueprintDoc('Revised design.'));
        const dirty = await harness.engine.refresh();
        expect(dirty.issues.some((i) => i.kind === 'work_order_out_of_sync' && i.nodeId === woId)).toBe(true);
        const dirtyScan = await harness.engine.scan();
        expect(dirtyScan.docs.find((d) => d.node.id === woId)?.node.status).toBe('out_of_sync');

        await harness.engine.acknowledge(woId);
        const clean = await harness.engine.inspect();
        expect(clean.issues.some((i) => i.kind === 'work_order_out_of_sync' && i.nodeId === woId)).toBe(false);
      }));
  });
}

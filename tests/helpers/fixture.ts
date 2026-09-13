import { commitAll, gitInit, makeTmpDir, writeFiles } from './tmp.js';

export const FIXTURE_FILES: Record<string, string> = {
  'prdm.config.json': JSON.stringify({ ignore: [] }),
  'docs/mrd/MRD-001.md': '---\nid: MRD-001\ntype: MRD\ntitle: "Mercado de asistentes de código"\nstatus: approved\n---\nLos equipos necesitan contexto de producto para agentes de IA.\n',
  'PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: "Graph Engine"\nstatus: approved\nimplements: ["MRD-001"]\ntags: ["graph", "mcp"]\n---\nMotor de grafos con detección de desincronización y work orders vía MCP.\n',
  'docs/blueprints/SDD-001.md':
    '---\nid: SDD-001\ntype: SDD\ntitle: "Arquitectura del Sync Monitor"\narchitects: ["PRD-001"]\ngoverns: ["src/sync/**"]\n---\nEl monitor compara hashes contra el baseline.\n\n## Tareas\n- [ ] Implementar hashing de código\n- [x] Leer commits de git\n',
  'docs/work-orders/WO-001.md':
    '---\nid: WO-001\ntype: WO\ntitle: "Leer commits de git"\nstatus: done\nimplements: ["SDD-001"]\nassigned_to: "agent:claude"\nclaimed_at: "2026-09-10T10:00:00.000Z"\ncompleted_at: "2026-09-10T14:00:00.000Z"\n---\nParsear trailers Refs.\n',
  'docs/artifacts/ART-001.md': '---\nid: ART-001\ntype: ART\ntitle: "Llamada con cliente"\nsource: call\nprovides_context_for: ["PRD-001"]\n---\nEl cliente pidió alertas de drift.\n',
  'src/sync/monitor.ts': 'export function detect() {\n  return 1;\n}\n',
};

export function createFixtureRepo(): string {
  const root = makeTmpDir('prdm-fixture-');
  writeFiles(root, FIXTURE_FILES);
  gitInit(root);
  commitAll(root, 'chore: initial docs\n\nRefs: WO-001');
  return root;
}

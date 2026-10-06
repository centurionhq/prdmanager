/**
 * The setup a developer has to do, as data (SDD-055/PRD-033 R4, canvas `ConstruirDeveloper.dc.html`).
 *
 * One table, not commands spread through JSX: R4 asks this screen to *be* the source of truth of the setup
 * that today travels from person to person, so adding or fixing a step has to be editing one row.
 *
 * Every command is built from the project being looked at and the browser's own origin — the server serves
 * this bundle, so that origin *is* the server's. A command copied with the wrong server is worse than no
 * command at all.
 */
export type SetupStepId = 'credencial' | 'vincular' | 'asistente';

export interface SetupStep {
  readonly id: SetupStepId;
  readonly title: string;
  readonly body: string;
  /** Literal text for the step's copy block, when the step is something to run. */
  readonly commands?: string;
}

export interface SetupTarget {
  readonly orgSlug: string;
  readonly projectSlug: string;
  /** Origin of this server, from the browser: `window.location.origin`. */
  readonly origin: string;
}

/**
 * The `prdm-remote` entry `prdm link --mcp` merges into `.mcp.json` (`@prdm/core`'s `planRemoteMcpJson`).
 * It is a literal here because `packages/app` may only import *types* from `@prdm/core`; that it stays
 * identical to what the command actually writes is asserted in `tests/unit/developer-setup.test.ts`, which
 * has no such restriction. No secret is ever in it: `prdm mcp-proxy` resolves the credential at runtime.
 */
export const MCP_ENTRY_SNIPPET = `{
  "mcpServers": {
    "prdm-remote": {
      "command": "prdm",
      "args": [
        "mcp-proxy"
      ]
    }
  }
}`;

export function developerSetupSteps({ orgSlug, projectSlug, origin }: SetupTarget): readonly SetupStep[] {
  return [
    {
      id: 'credencial',
      title: 'Crear tu credencial',
      body: 'Una credencial personal tuya, con permiso de leer y escribir documentos. No la compartas: es lo que identifica tus cambios.',
    },
    {
      id: 'vincular',
      title: 'Vincular el repositorio',
      body: 'Corré esto en la raíz de tu copia del repositorio. Deja el proyecto atado, escribe la configuración del asistente e instala el gancho que exige nombrar la orden de trabajo en cada commit.',
      commands: [`prdm login --server ${origin}`, `prdm link ${orgSlug}/${projectSlug} --server ${origin} --mcp`, 'prdm hooks install'].join('\n'),
    },
    {
      id: 'asistente',
      title: 'Elegir tu asistente',
      body: 'Abrí el asistente en el repositorio y aprobá el servidor la primera vez que te lo pida.',
    },
  ];
}

export interface Assistant {
  readonly id: string;
  readonly label: string;
  readonly body: string;
  /** Whether the person has to paste the entry themselves: false when `prdm link --mcp` already wrote the
   * file that assistant reads. */
  readonly needsSnippet: boolean;
}

/**
 * Only what this repository can actually back up. Claude Code reads `.mcp.json` at the repository root, which
 * is exactly the file `prdm link --mcp` writes. Cursor is drawn on the canvas but nothing here documents where
 * it expects its configuration, nor that anyone tried it against this MCP: claiming it on the screen R4 wants
 * as the source of truth would be inventing. FB-034 carries that as a product question.
 */
export const ASSISTANTS: readonly Assistant[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    body: 'El paso anterior ya escribió el archivo .mcp.json en la raíz del repositorio, que es el que lee. No tenés que pegar nada.',
    needsSnippet: false,
  },
  {
    id: 'otro',
    label: 'Otro cliente MCP',
    body: 'Pegá esta entrada donde tu cliente lea sus servidores MCP. No lleva ningún secreto: la credencial la resuelve el proxy en tu máquina, al momento de usarla.',
    needsSnippet: true,
  },
];

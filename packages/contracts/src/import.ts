/**
 * `POST /api/v1/projects/:graphProjectId/import` request (SDD-010 "Importador", a later WO than this
 * one builds the endpoint itself; this WO only defines the contract with its size limits, per SDD-010's
 * own task line: "...e importación con límites de tamaño en packages/contracts"). `prdm link --import`
 * uploads the local `docs/` tree (already validated client-side with `@prdm/core`) plus the raw
 * `.prdm.yaml` text and an optional local `.prdm/baseline.json`; the server re-validates everything
 * itself (SDD-010: "el servidor re-valida todo") rather than trusting any of this at face value.
 *
 * `MAX_IMPORT_BODY_BYTES`/`MAX_IMPORT_DOCUMENTS` are operational limits chosen for this WO — SDD-010
 * does not pin exact numbers, only that a limit must exist ("límite de cuerpo y de cantidad de
 * documentos").
 */
import { z } from 'zod';

export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_DOCUMENTS = 5000;
export const MAX_IMPORT_DOCUMENT_BYTES = 1_000_000;

export const importDocumentSchema = z.strictObject({
  /** Repo-relative path as it exists locally today; the server normalizes this itself (a later WO)
   * rather than trusting it verbatim (SDD-010: "normaliza cada source_path ... rechazando rutas
   * inseguras"). */
  sourcePath: z.string().min(1).max(1000),
  content: z.string().max(MAX_IMPORT_DOCUMENT_BYTES),
});
export type ImportDocumentDto = z.infer<typeof importDocumentSchema>;

export const importRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  /** Raw `.prdm.yaml` text; the server re-validates it with the core schema and ignores the local
   * `project.id` (SDD-010: "ignora el project.id local"). */
  prdmYaml: z.string().min(1).max(200_000),
  documents: z.array(importDocumentSchema).max(MAX_IMPORT_DOCUMENTS),
  /** Raw `.prdm/baseline.json` text, when present locally; optional since a fresh repo may not have one. */
  baselineJson: z.string().max(MAX_IMPORT_DOCUMENT_BYTES).optional(),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

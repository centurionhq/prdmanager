import type { AuthoringService, Engine, GraphStore, PrdmConfig } from '@prdm/core';

/** Everything a tool/resource/prompt handler needs; built once at startup and shared by every registration. */
export interface PrdmDeps {
  config: PrdmConfig;
  store: GraphStore;
  engine: Engine;
  /** Conversational authoring surface (SDD-002 "Autoría conversacional"); one DraftStore per server process. */
  authoring: AuthoringService;
}

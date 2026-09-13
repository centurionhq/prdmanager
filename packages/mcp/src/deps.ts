import type { Engine, GraphStore, PrdmConfig } from '@prdm/core';

/** Everything a tool/resource/prompt handler needs; built once at startup and shared by every registration. */
export interface PrdmDeps {
  config: PrdmConfig;
  store: GraphStore;
  engine: Engine;
}

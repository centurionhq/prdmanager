import type { PrdmConfig } from '../config.js';
import type { Engine } from '../engine.js';
import type { GraphStore } from '../graph/types.js';

/** Everything a tool/resource/prompt handler needs; built once at startup and shared by every registration. */
export interface PrdmDeps {
  config: PrdmConfig;
  store: GraphStore;
  engine: Engine;
}

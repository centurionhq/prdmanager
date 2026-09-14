/**
 * Library entrypoint (WO-129/SDD-007): everything a host process (a future server profile, tests) needs to
 * build and wire an in-process prdm-graph MCP server, WITHOUT ever running `main()` — unlike importing `.`
 * (`server.ts`, the stdio binary), which connects to a real Neo4j and starts listening as a side effect of
 * being imported. Only re-exports; never imports `./server.js`.
 */
export { createPrdmServer } from './create.js';
export { registerPrdmTools, type RegisterPrdmToolsOptions } from './tools.js';
export { escapeFenceChars, fenceTag } from './prompts.js';
export { requireAuthoring, type PrdmDeps } from './deps.js';

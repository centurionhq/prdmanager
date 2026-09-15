/**
 * Barrel re-export of every mock data module (WO-272), so screens can import from a single
 * `src/data` entry point instead of reaching into individual files.
 */
export * from './types';

export * from './features';
export * from './blueprints';
export * from './workOrders';

export * from './documents';
export * from './versions';
export * from './comments';
export * from './proposals';
export * from './validation';

export * from './drift';
export * from './commits';
export * from './codeRefs';
export * from './metrics';
export * from './inbox';
export * from './people';
export * from './projects';
export * from './tokens';
export * from './sso';

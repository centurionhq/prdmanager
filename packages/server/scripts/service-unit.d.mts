/** Declaraciones de service-unit.mjs. */
export declare const SERVICE_TEMPLATE_DIR: string;
export declare const SERVICE_NAME_ENV: string;

export interface ResolveServiceNameOptions {
  env?: Record<string, string | undefined>;
  templateDir?: string;
}

export declare function resolveServiceName(options?: ResolveServiceNameOptions): string;

export declare const SERVICE_NAME: string;

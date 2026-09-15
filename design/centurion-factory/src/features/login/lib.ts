/**
 * Login validation helpers and the demo credentials (WO-302). Kept free of React so both the
 * SSO and password forms can share the same rules.
 */

export const CENTURIONHQ_DOMAIN = 'centurionhq.com';
export const DEMO_EMAIL = 'ana.rios@centurionhq.com';
export const DEMO_PASSWORD = 'centurion';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** Returns the lowercase domain of a well-formed email, or `undefined` otherwise. */
export function domainOf(email: string): string | undefined {
  const trimmed = email.trim().toLowerCase();
  if (!isValidEmail(trimmed)) return undefined;
  return trimmed.split('@')[1];
}

export function hasCenturionSso(email: string): boolean {
  return domainOf(email) === CENTURIONHQ_DOMAIN;
}

export function matchesDemoCredentials(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD;
}

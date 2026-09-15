/**
 * Server URL validation (SDD-010 "CLI: credenciales y vinculación", WO-187): "solo https salvo
 * loopback, validado con URL" — parsed with the real `URL` constructor (never a regex, which a
 * cleverly-crafted string like `https://evil.com#@trusted.example.com` could fool), so the parts a
 * regex could get subtly wrong (userinfo, IPv6 host brackets, punycode) are exactly what the platform's
 * own URL parser already handles correctly.
 */
import { CliError } from '../errors.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHostname(hostname: string): boolean {
  // `URL#hostname` keeps the brackets for an IPv6 literal (e.g. `[::1]`, not `::1`) — accepting both
  // forms here rather than stripping them keeps this function correct regardless of whether a caller
  // passes it a `URL#hostname` value or a bare literal typed by hand.
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** Throws `CliError` for anything that isn't a well-formed `https://` URL, or a well-formed `http://`/
 * `https://` URL whose host is loopback. Returns the parsed `URL` (its `.origin` is the exact
 * credentials key). */
export function parseServerUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError(`invalid server URL: ${input}`);
  }

  const isHttps = url.protocol === 'https:';
  const isHttpLoopback = url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  if (!isHttps && !isHttpLoopback) {
    throw new CliError(`server must be https:// (http:// is only allowed for loopback hosts): ${input}`);
  }
  return url;
}

/**
 * Test-only TOTP helper (WO-102): computes a valid code from an enrolled `otpauth://` URI so
 * integration tests can complete a real `/two-factor/verify-totp` challenge without ever touching an
 * authenticator app. Deliberately reimplements RFC 6238 (SHA-1, 6 digits, 30s step — the exact
 * defaults better-auth's own `totp2fa` plugin uses) with an injectable `clock`, rather than depending on
 * better-auth's internal `@better-auth/utils/otp` (which always reads `Date.now()` itself), so a test
 * can pass a fixed `Date` instead of relying on wall-clock timing.
 */
import { createHmac } from 'node:crypto';

const PERIOD_SECONDS = 30;
const DIGITS = 6;

function extractTotpSecret(otpauthUri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(otpauthUri);
  if (!match) throw new Error('no "secret" query parameter in TOTP URI');
  return base32Decode(decodeURIComponent(match[1]!));
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes a base32 string (as emitted in an `otpauth://` URI) back into the original UTF-8 secret
 * string — better-auth base32-encodes the raw secret only for the URI; the value it actually signs
 * with is the original string, recovered here by decoding then re-reading the bytes as UTF-8. */
function base32Decode(encoded: string): string {
  let bits = '';
  for (const char of encoded.toUpperCase()) {
    if (char === '=') break;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character "${char}"`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes).toString('utf8');
}

function hotp(secret: string, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  const otp = binCode % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, '0');
}

/** Computes the current TOTP code for the secret embedded in `otpauthUri`, as of `clock()` (defaults to
 * the real current time — this is a one-shot read, never a sleep, so it stays within the "no
 * wall-clock assertions" rule: nothing here waits for time to pass). */
export function computeTotpCode(otpauthUri: string, clock: () => Date = () => new Date()): string {
  const secret = extractTotpSecret(otpauthUri);
  const counter = BigInt(Math.floor(clock().getTime() / 1000 / PERIOD_SECONDS));
  return hotp(secret, counter);
}

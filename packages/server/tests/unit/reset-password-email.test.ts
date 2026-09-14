import { describe, expect, test } from 'vitest';
import { buildResetPasswordEmail } from '../../src/email/reset-password-email.js';
import { escapeHtml, sanitizeNameForHtml, sanitizeNameForText, stripCrLf } from '../../src/email/sanitize.js';

describe('escapeHtml', () => {
  test('escapes &, <, >, " and \'', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quoted'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;',
    );
  });
});

describe('stripCrLf', () => {
  test('collapses embedded CR/LF into a single space and trims', () => {
    expect(stripCrLf('Evil\r\nBcc: attacker@evil.test')).toBe('Evil Bcc: attacker@evil.test');
    expect(stripCrLf('  padded \n ')).toBe('padded');
  });
});

describe('sanitizeNameForHtml / sanitizeNameForText', () => {
  test('HTML variant both strips CR/LF and escapes HTML-significant characters', () => {
    expect(sanitizeNameForHtml('<b>Evil</b>\r\nName')).toBe('&lt;b&gt;Evil&lt;/b&gt; Name');
  });

  test('text variant only strips CR/LF, leaving other characters untouched', () => {
    expect(sanitizeNameForText('<b>Evil</b>\r\nName')).toBe('<b>Evil</b> Name');
  });
});

describe('buildResetPasswordEmail', () => {
  const url = 'https://app.example.test/reset-password/abc123?token=abc123';

  test('embeds the exact reset url in both the text and html bodies', () => {
    const email = buildResetPasswordEmail({ userName: 'Ada Lovelace', userEmail: 'ada@example.test', url });
    expect(email.text).toContain(url);
    expect(email.html).toContain(url);
    expect(email.to).toBe('ada@example.test');
    expect(email.subject).toBe('Reset your prdm password');
  });

  test('HTML-escapes a user name shaped like a script injection', () => {
    const email = buildResetPasswordEmail({ userName: '<script>alert(1)</script>', userEmail: 'x@example.test', url });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('strips CR/LF from a user name in both bodies', () => {
    const email = buildResetPasswordEmail({ userName: 'Evil\r\nBcc: attacker@evil.test', userEmail: 'x@example.test', url });
    expect(email.text).not.toMatch(/[\r\n]Bcc:/);
    expect(email.html).not.toMatch(/[\r\n]Bcc:/);
    expect(email.text).toContain('Evil Bcc: attacker@evil.test');
  });
});

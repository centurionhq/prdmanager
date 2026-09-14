/**
 * WO-096 — password reset over HTTP: no email enumeration, single-use tokens, and (against the real
 * mailpit instance) actual SMTP delivery through nodemailer 10.0.9 with escaped content
 * (SDD-006 §Autenticación). Runs against the real test Postgres instance (5433).
 */
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connect, schema } from '@prdm/db';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { NodemailerMailer } from '../../src/nodemailer-mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const AUTH_SCHEMA = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
  organization: schema.organization,
  member: schema.member,
  invitation: schema.invitation,
  twoFactor: schema.twoFactor,
};

function buildSeedAuth(env: ReturnType<typeof buildTestServerEnv>, pool: PgTestDb['appPool']) {
  const database = drizzleAdapter(connect(pool), { provider: 'pg', schema: AUTH_SCHEMA });
  return betterAuth({
    database,
    baseURL: env.publicUrl,
    secret: env.betterAuthSecret,
    emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
    logger: { disabled: true },
  });
}

async function fetchMailpitMessageBySubjectFragment(subjectFragment: string): Promise<{ Subject: string; ID: string } | undefined> {
  const res = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=50');
  const body = (await res.json()) as { messages: { Subject: string; ID: string }[] };
  return body.messages.find((m) => m.Subject.includes(subjectFragment));
}

async function fetchMailpitMessageText(id: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:8025/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string; HTML: string };
  return body.Text;
}

describe('password reset over HTTP (WO-096)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterAll(async () => {
    await pg.close();
  });

  async function seedUser(name = 'Test User', password = 'correct-horse-battery-staple'): Promise<{ email: string }> {
    const seedAuth = buildSeedAuth(env, pg.appPool);
    const email = `${randomUUID()}@example.test`;
    await seedAuth.api.signUpEmail({ body: { name, email, password } });
    return { email };
  }

  test('requesting a reset for an existing and a non-existing email returns identical responses', async () => {
    const { email } = await seedUser();
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const existing = await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });
    const nonExisting = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: `${randomUUID()}@example.test` },
      headers: AUTH_HOST,
    });

    expect(existing.statusCode).toBe(nonExisting.statusCode);
    expect(existing.json()).toEqual(nonExisting.json());
    // Only the real account actually got an email; the non-existing one silently no-ops.
    expect(mailer.messages).toHaveLength(1);

    await app.close();
  });

  test('a reset token can only be used once', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser('Test User', password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });
    const resetUrl = mailer.messages[0]!.text.match(/https?:\/\/\S+/)![0]!;
    const token = resetUrl.split('/reset-password/')[1]!.split('?')[0]!;

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { newPassword: 'a-brand-new-password', token },
      headers: AUTH_HOST,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { newPassword: 'yet-another-password', token },
      headers: AUTH_HOST,
    });
    expect(second.statusCode).not.toBe(200);

    await app.close();
  });

  test('the captured email HTML-escapes the user name and strips CR/LF', async () => {
    const dangerousName = 'Evil<script>alert(1)</script>\r\nBcc: attacker@evil.test';
    const { email } = await seedUser(dangerousName);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });

    expect(mailer.messages).toHaveLength(1);
    const message = mailer.messages[0]!;
    expect(message.html).not.toContain('<script>alert(1)</script>');
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.text).not.toMatch(/[\r\n]Bcc:/);

    await app.close();
  });

  test('NodemailerMailer actually delivers to mailpit (real SMTP transport)', async () => {
    const mailer = new NodemailerMailer(env.smtp);
    const subjectFragment = `wo-096-${randomUUID()}`;

    await mailer.sendMail({ to: 'someone@example.test', subject: `Test ${subjectFragment}`, text: 'hello from WO-096', html: '<p>hello</p>' });

    const message = await fetchMailpitMessageBySubjectFragment(subjectFragment);
    expect(message).toBeDefined();
    const text = await fetchMailpitMessageText(message!.ID);
    expect(text).toContain('hello from WO-096');
  });
});

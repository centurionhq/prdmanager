import { describe, expect, test } from 'vitest';
import { normalizeArtifactContent } from '../../src/artifacts/ingest.js';

describe('normalizeArtifactContent', () => {
  test('vtt: strips WEBVTT header, cue numbers and timing lines, keeps speaker text', () => {
    const vtt =
      'WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:04.000\r\nHello there.\r\n\r\n2\r\n00:00:04.000 --> 00:00:08.000\r\nSpeaker2: How are you?\r\n';
    expect(normalizeArtifactContent(vtt, 'vtt')).toBe('Hello there.\n\nSpeaker2: How are you?\n');
  });

  test('srt: strips cue numbers and comma-separated timing lines', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:08,000\nHow are you?\n';
    expect(normalizeArtifactContent(srt, 'srt')).toBe('Hello there.\n\nHow are you?\n');
  });

  test('eml: keeps only Subject/From/To/Date headers plus the body', () => {
    const eml =
      'From: alice@example.com\nTo: bob@example.com\nSubject: Meeting notes\nDate: Mon, 1 Jan 2024 10:00:00 +0000\nX-Mailer: foo\n\nBody text\nacross lines.\n';
    expect(normalizeArtifactContent(eml, 'eml')).toBe(
      'From: alice@example.com\nTo: bob@example.com\nSubject: Meeting notes\nDate: Mon, 1 Jan 2024 10:00:00 +0000\n\nBody text\nacross lines.\n',
    );
  });

  test('eml: header matching is case-insensitive and drops unlisted headers entirely', () => {
    const eml = 'subject: Hi\nX-Priority: 1\n\nBody\n';
    expect(normalizeArtifactContent(eml, 'eml')).toBe('subject: Hi\n\nBody\n');
  });

  test('txt/md/json: passes content through unchanged besides newline normalization', () => {
    expect(normalizeArtifactContent('line1\r\nline2\r\n', 'txt')).toBe('line1\nline2\n');
    expect(normalizeArtifactContent('# title\r\nbody', 'md')).toBe('# title\nbody');
    expect(normalizeArtifactContent('{"a":1}', 'json')).toBe('{"a":1}');
  });
});

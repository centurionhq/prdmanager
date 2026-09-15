import { describe, expect, test } from 'vitest';
import { commentBodySchema, createCommentThreadInputSchema } from '../../src/comments.js';

describe('commentBodySchema', () => {
  test('accepts an ordinary multi-line body', () => {
    expect(commentBodySchema.safeParse('line one\nline two\twith a tab').success).toBe(true);
  });

  test('rejects an empty body', () => {
    expect(commentBodySchema.safeParse('').success).toBe(false);
  });

  test('rejects a body over the 10KB limit', () => {
    expect(commentBodySchema.safeParse('a'.repeat(10 * 1024 + 1)).success).toBe(false);
  });

  test('rejects a body containing a C0 control character (e.g. a bell/backspace)', () => {
    expect(commentBodySchema.safeParse('hi\x07there').success).toBe(false);
    expect(commentBodySchema.safeParse('hi\x08there').success).toBe(false);
  });

  test('rejects a body containing DEL (0x7F)', () => {
    expect(commentBodySchema.safeParse('hi\x7Fthere').success).toBe(false);
  });

  test('still allows \\t, \\n, \\r (not classified as forbidden control characters)', () => {
    expect(commentBodySchema.safeParse('a\tb\nc\rd').success).toBe(true);
  });
});

describe('createCommentThreadInputSchema', () => {
  test('accepts a valid range and body', () => {
    expect(createCommentThreadInputSchema.safeParse({ startIndex: 0, endIndex: 5, body: 'nice' }).success).toBe(true);
  });

  test('rejects a negative startIndex', () => {
    expect(createCommentThreadInputSchema.safeParse({ startIndex: -1, endIndex: 5, body: 'nice' }).success).toBe(false);
  });
});

/**
 * Common-prefix/common-suffix diff between two plain strings (WO-378): the smallest single
 * delete-then-insert that turns `before` into `after`. Used to reconcile an IME composition's actual DOM
 * result at `compositionend` against what the model expected before composition started, instead of
 * trusting the noisy intermediate `beforeinput` events a composition fires along the way.
 */
export interface TextDiff {
  start: number;
  deleteCount: number;
  insertText: string;
}

export function diffText(before: string, after: string): TextDiff {
  const maxCommon = Math.min(before.length, after.length);

  let prefix = 0;
  while (prefix < maxCommon && before[prefix] === after[prefix]) prefix++;

  const maxSuffix = maxCommon - prefix;
  let suffix = 0;
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;

  return { start: prefix, deleteCount: before.length - prefix - suffix, insertText: after.slice(prefix, after.length - suffix) };
}

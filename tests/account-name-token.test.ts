import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_NAME_PROPERTY, accountNameToken } from '../src/client/compat/account-menu.ts';

const sheet = readFileSync(
  fileURLToPath(new URL('../src/client/features/sidebar/account-menu.css', import.meta.url)),
  'utf8',
);

const HEADER_RULE = /\[data-ccd-account-menu\]::before\s*\{([^}]*)\}/;
const HEADER_CONTENT = /content:\s*([^;]+);/;

/** The `content` declaration the header rule makes, before substitution. */
function headerContent(): string {
  const rule = HEADER_RULE.exec(sheet);
  assert.ok(rule !== null, 'the stylesheet should still paint the header');
  const declaration = HEADER_CONTENT.exec(rule[1] ?? '');
  assert.ok(declaration !== null, 'the header should be painted with `content`');
  return (declaration[1] ?? '').trim();
}

const HEX_DIGIT = /[\da-f]/i;
const RAW_BREAK = /[\n\r\f]/;

/**
 * The text `content` paints for `value`, or `undefined` when `value` is not
 * exactly one CSS string token.
 *
 * This is the browser's own computed-value-time check, cut down to the one
 * production this plugin relies on. After `var()` substitution the resulting
 * tokens are matched against `content`'s grammar, which takes `normal`, `none`,
 * or a content list — never a bare word. A value that fails is invalid at
 * computed-value time, so `content` behaves as `unset` and lands on its initial
 * `normal`, which computes to `none` on `::before`: the pseudo-element is not
 * generated and the header vanishes, padding included. Escapes are consumed the
 * way css-syntax-3 consumes them, so a decoded name proves both that the token
 * is legal and that it still says the name.
 */
function paintedBy(value: string): string | undefined {
  const quote = value.charAt(0);
  if (value.length < 2 || (quote !== '"' && quote !== "'") || value.at(-1) !== quote) return undefined;
  const body = value.slice(1, -1);
  let text = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    /* The quote that opened the string ends it, and a raw newline makes it a
       <bad-string-token>: either way the value is not one string token. */
    if (character === quote || RAW_BREAK.test(character)) return undefined;
    if (character !== '\\') {
      text += character;
      continue;
    }
    const next = body.charAt(index + 1);
    /* A backslash that escapes the closing quote, or ends the value. */
    if (next === '') return undefined;
    if (HEX_DIGIT.test(next)) {
      let digits = '';
      index += 1;
      while (digits.length < 6 && index < body.length && HEX_DIGIT.test(body.charAt(index))) {
        digits += body.charAt(index);
        index += 1;
      }
      const code = Number.parseInt(digits, 16);
      text += code === 0 || code > 0x10ffff ? '\uFFFD' : String.fromCodePoint(code);
      /* One whitespace code point after a hex escape belongs to the escape. */
      if (body.charAt(index) === ' ' || body.charAt(index) === '\t') continue;
      index -= 1;
      continue;
    }
    index += 1;
    text += next === '\n' ? '' : next;
  }
  return text;
}

/** The header's declaration with the property substituted into it, as the UA does it. */
function substitutedWith(declaration: string, name: string): string {
  /* A function replacement, so a name holding `$&` still lands as it stands. */
  return declaration.replace(/var\([^)]*\)/, () => accountNameToken(name));
}

const NAMES = [
  'Zou Kai',
  'O\'Brien 的名字',
  '$& 与 $1 也是名字',
  'zo"u',
  'back\\slash',
  '中文名字',
  '账户 "引号" 与 \\ 反斜杠',
  'a\nb\tc\u0007d',
  '🦊 狐狸\u007f',
  '',
];

test('a name reaches the menu as one quoted CSS string token', () => {
  for (const name of NAMES) {
    const token = accountNameToken(name);
    assert.equal(token.charAt(0), '"', `${JSON.stringify(name)} should arrive quoted`);
    assert.equal(token.at(-1), '"', `${JSON.stringify(name)} should arrive quoted`);
    assert.equal(paintedBy(token), name, `${JSON.stringify(name)} should paint unchanged`);
  }
});

test('the quote, the backslash, and the control characters take CSS escapes', () => {
  assert.equal(accountNameToken('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(accountNameToken('a\nb\tc\u0007d'), '"a\\00000a b\\000009 c\\000007 d"');
  /* Six digits plus one terminating space: the space is consumed while the
     value is tokenized and never painted, and a hex digit of the name behind
     the escape cannot be swallowed by it. */
  assert.equal(accountNameToken('\u0007a'), '"\\000007 a"');
  assert.equal(paintedBy(accountNameToken('\u0007a')), '\u0007a');
});

test('an unquoted name is not a content value, which is what dropped the header', () => {
  for (const name of NAMES) {
    /* The JSON string form with its quotes stripped — what the token used to
       be, and what made the whole line disappear. */
    const unquoted = JSON.stringify(name).slice(1, -1);
    assert.equal(paintedBy(unquoted), undefined, `${JSON.stringify(name)} unquoted should not paint`);
  }
});

test('the stylesheet reads the property as a string after var() substitution', () => {
  const declaration = headerContent();
  assert.equal(declaration, `var(${ACCOUNT_NAME_PROPERTY}, "")`);
  for (const name of NAMES) {
    const painted = substitutedWith(declaration, name);
    assert.equal(paintedBy(painted), name, `${JSON.stringify(name)} should paint through the rule`);
  }
  /* The fallback has to be a string as well: `normal` would compute to `none`
     and generate no header at all. */
  const fallback = declaration.slice(declaration.indexOf(',') + 1, -1).trim();
  assert.equal(paintedBy(fallback), '');
});

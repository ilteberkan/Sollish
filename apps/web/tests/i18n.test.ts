import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LOCALE, HTML_LANG, INTL_LOCALE, LOCALES, isLocale, localeDir } from '../lib/i18n/config';
import { matchAcceptLanguage, parseAcceptLanguage, resolveLocale } from '../lib/i18n/negotiate';
import { formatMessage, messageArguments, messageTags, splitTags } from '../lib/i18n/message-format';
import { NAMESPACES, loadNamespace, missingKeys, withFallback, type Dictionary } from '../lib/i18n/catalog';
import { createTranslator } from '../lib/i18n/translator';
import { getFormatter } from '../lib/i18n/format';
import { formatAmount, formatDemo, formatFactor, formatSignedDemo } from '../lib/slot-kit/bet';

const MESSAGES = join(import.meta.dirname, '..', 'messages');
const read = (locale: string, ns: string): Dictionary => JSON.parse(readFileSync(join(MESSAGES, locale, `${ns}.json`), 'utf8'));
function leaves(dict: Dictionary, prefix = ''): Array<[string, string]> {
  return Object.entries(dict).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value] as [string, string]] : leaves(value, `${prefix}${key}.`));
}

test('catalog files: every locale has exactly the namespaces of en', () => {
  const en = readdirSync(join(MESSAGES, DEFAULT_LOCALE)).sort();
  assert.deepEqual(en, NAMESPACES.map(ns => `${ns}.json`).sort());
  for (const locale of LOCALES) assert.deepEqual(readdirSync(join(MESSAGES, locale)).sort(), en, locale);
  assert.deepEqual(readdirSync(MESSAGES).sort(), [...LOCALES].sort());
});

test('catalogs: every locale has every en key, no extras, matching arguments and tags, and parses', () => {
  for (const ns of NAMESPACES) {
    const en = read(DEFAULT_LOCALE, ns);
    const enLeaves = new Map(leaves(en));
    for (const locale of LOCALES) {
      const own = read(locale, ns);
      assert.deepEqual(missingKeys(en, own), [], `${locale}/${ns} missing keys`);
      assert.deepEqual(missingKeys(own, en), [], `${locale}/${ns} has keys en does not have`);
      for (const [key, text] of leaves(own)) {
        const source = enLeaves.get(key)!;
        assert.deepEqual(messageArguments(text), messageArguments(source), `${locale}/${ns}:${key} arguments`);
        assert.deepEqual(messageTags(text), messageTags(source), `${locale}/${ns}:${key} tags`);
        assert.ok(text.trim().length > 0, `${locale}/${ns}:${key} is empty`);
        assert.doesNotThrow(() => formatMessage(text, INTL_LOCALE[locale], {}), `${locale}/${ns}:${key} parses`);
      }
    }
  }
});

test('locale config: html lang, Intl tags, direction', () => {
  assert.equal(LOCALES.length, 9);
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.equal(HTML_LANG.tr, 'tr');
  assert.equal(HTML_LANG.zh, 'zh-Hans');
  for (const locale of LOCALES) { assert.equal(localeDir(locale), 'ltr'); assert.ok(INTL_LOCALE[locale]); }
  assert.ok(isLocale('ko'));
  assert.ok(!isLocale('zh-Hans'));
  assert.ok(!isLocale(undefined));
});

test('Accept-Language negotiation: q-values, primary subtag, Chinese variants, fallback', () => {
  assert.deepEqual(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5'), ['fr-ch', 'fr', 'en', 'de', '*']);
  assert.deepEqual(parseAcceptLanguage('en;q=0.2, tr'), ['tr', 'en']);
  assert.deepEqual(parseAcceptLanguage('de;q=0, it'), ['it']);
  assert.equal(matchAcceptLanguage('pt-BR,pt;q=0.9'), 'pt');
  assert.equal(matchAcceptLanguage('zh-TW'), 'zh');
  assert.equal(matchAcceptLanguage('zh-Hant-HK'), 'zh');
  assert.equal(matchAcceptLanguage('ko-KR,ko;q=0.9,en-US;q=0.8'), 'ko');
  assert.equal(matchAcceptLanguage('nl-NL, sv;q=0.8, es;q=0.5'), 'es');
  assert.equal(matchAcceptLanguage('ja, *'), null);
  assert.equal(matchAcceptLanguage(''), null);
  assert.equal(matchAcceptLanguage('<<garbage>>'), null);
  assert.equal(resolveLocale('tr', 'de-DE'), 'tr', 'cookie wins');
  assert.equal(resolveLocale('xx', 'de-DE'), 'de', 'invalid cookie is ignored');
  assert.equal(resolveLocale(undefined, 'ja-JP'), 'en', 'default');
  assert.equal(resolveLocale(null, null), 'en');
});

test('message format: interpolation, plurals with Intl.PluralRules, select, quoting', () => {
  assert.equal(formatMessage('Hello {name}', 'en-US', { name: 'Ada' }), 'Hello Ada');
  assert.equal(formatMessage('{n} spins', 'en-US', { n: 1000 }), '1,000 spins');
  assert.equal(formatMessage('{n} tur', 'tr-TR', { n: 1000 }), '1.000 tur');
  const spins = '{n, plural, =0 {no spins} one {# spin} other {# spins}}';
  assert.equal(formatMessage(spins, 'en-US', { n: 0 }), 'no spins');
  assert.equal(formatMessage(spins, 'en-US', { n: 1 }), '1 spin');
  assert.equal(formatMessage(spins, 'en-US', { n: 25 }), '25 spins');
  assert.equal(formatMessage('{n, plural, one {# tour} other {# tours}}', 'fr-FR', { n: 0 }), '0 tour', 'French: 0 is singular');
  assert.equal(formatMessage('{u, select, ebru {drops} other {stones}}', 'en-US', { u: 'ebru' }), 'drops');
  assert.equal(formatMessage('{u, select, ebru {drops} other {stones}}', 'en-US', { u: 'tarhun' }), 'stones');
  assert.equal(formatMessage("It''s '{literal}' l'eau", 'en-US'), "It's {literal} l'eau");
  assert.equal(formatMessage('missing {x}', 'en-US'), 'missing {x}');
  assert.deepEqual(messageArguments('{a} {n, plural, one {# {b}} other {{c}}}'), ['a', 'b', 'c', 'n']);
  assert.throws(() => formatMessage('{n, plural, one {x}}', 'en-US', { n: 1 }), /other/);
  assert.throws(() => formatMessage('oops }', 'en-US'));
  assert.deepEqual(splitTags('See the <link>page</link> now', { link: c => ({ c }) }), ['See the ', { c: 'page' }, ' now']);
  assert.deepEqual(splitTags('<x>kept</x>', {}), ['kept'], 'unknown tags lose their markup');
});

test('translator: lookup, missing key and missing namespace fall back to the key', () => {
  const t = createTranslator('en', 'slotKit', read('en', 'slotKit'));
  assert.equal(t('bet.label'), 'Bet');
  assert.equal(t('autoplay.startWith', { label: 'Start', spins: 1 }), 'Start · 1 spin');
  assert.equal(t('autoplay.startWith', { label: 'Start', spins: 50 }), 'Start · 50 spins');
  assert.equal(t('autoplay.reasons.tab-hidden'), 'Stopped because the tab was hidden');
  assert.equal(t('nope.key' as never), 'slotKit.nope.key');
  assert.ok(t.has('winTier.max.word'));
  const tr = createTranslator('tr', 'slotKit', read('tr', 'slotKit'));
  assert.equal(tr('autoplay.startWith', { label: 'Başlat', spins: 10 }), 'Başlat · 10 tur');
  assert.equal(tr('autoplay.stopAria', { remaining: 3 }), 'Otomatik oyunu durdur, 3 tur kaldı');
  assert.equal(tr('winTier.max.word'), 'AZAMİ');
  const none = createTranslator('de', 'verify', undefined);
  assert.equal(none('verify.title'), 'verify.verify.title');
  const rich = createTranslator('en', 'common', read('en', 'common')).rich('game.noticeRemote', { link: chunk => `[${chunk}]` });
  assert.ok(rich.includes('[verification page]'));
});

test('fallback merge keeps en shape and fills missing keys', async () => {
  const en = { a: 'A', nested: { b: 'B', c: 'C' } };
  assert.deepEqual(withFallback(en, { a: 'x', nested: { b: 'y' }, extra: 'z' }), { a: 'x', nested: { b: 'y', c: 'C' } });
  assert.deepEqual(missingKeys(en, { nested: { b: 1 } }), ['a', 'nested.b', 'nested.c']);
  const ko = await loadNamespace('ko', 'slotKit');
  assert.equal((ko.settings as Dictionary).language, '언어');
});

test('formatter: integer-exact amounts per locale; tr matches the legacy slot-kit formatter', () => {
  const tr = getFormatter('tr');
  for (const cents of [0, 5, 1234, 123_456, 100_000_000, -250, 10_050]) {
    assert.equal(tr.amount(cents), formatAmount(cents));
    assert.equal(tr.demo(cents), formatDemo(cents));
    assert.equal(tr.signedDemo(cents), formatSignedDemo(cents));
  }
  assert.equal(tr.amount(10_000, { trimZeros: true }), '100');
  for (const [n, d] of [[5, 4], [1, 1], [3, 2], [100, 1]] as const) assert.equal(tr.factor(n, d), formatFactor(n, d));
  assert.equal(tr.percent(0.7), '%70');
  const en = getFormatter('en');
  assert.equal(en.demo(123_456), '1,234.56 DEMO');
  assert.equal(en.signedDemo(-300), '−3.00 DEMO');
  assert.equal(en.signedDemo(1240), '+12.40 DEMO');
  assert.equal(en.factor(5, 4), '×1.25');
  assert.equal(en.times(1250), '12.5');
  assert.equal(en.decimal, '.');
  assert.equal(getFormatter('de').demo(123_456), '1.234,56 DEMO');
  assert.equal(getFormatter('zh').demo(99), '0.99 DEMO');
  assert.equal(getFormatter('ko').amount(900_719_925_474_099), '9,007,199,254,740.99', 'large safe integers stay exact');
  assert.equal(en.amount(1.5), '—');
  assert.equal(en.clock(Number.NaN), '--:--');
});

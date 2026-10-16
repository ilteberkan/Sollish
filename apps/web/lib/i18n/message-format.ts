/**
 * A small ICU MessageFormat subset (no dependency):
 *   {name}                       value; numbers are formatted with Intl.NumberFormat for the locale
 *   {name, number}               same, explicit
 *   {n, plural, =0 {…} one {# spin} other {# spins}}   Intl.PluralRules; `#` is n, locale-formatted
 *   {x, select, a {…} other {…}} exact string match, `other` as fallback
 *   ''  → a literal apostrophe;  '{…}'  → quoted literal braces (ICU rule: a lone ' before other text is literal)
 * Rich text for React (`<link>…</link>`) is handled by `splitTags` after formatting.
 * Messages are parsed once and cached; formatting is pure apart from the Intl caches.
 */

export type MessageVars = Readonly<Record<string, string | number>>;

type Node =
  | string
  | { kind: 'arg'; name: string }
  | { kind: 'pound' }
  | { kind: 'plural'; name: string; options: Readonly<Record<string, Node[]>> }
  | { kind: 'select'; name: string; options: Readonly<Record<string, Node[]>> };

export class MessageSyntaxError extends Error {}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parse(source: string): Node[] {
  let i = 0;
  const fail = (why: string): never => { throw new MessageSyntaxError(`${why} at ${i} in "${source}"`); };
  const ws = () => { while (i < source.length && /\s/.test(source[i]!)) i++; };
  const word = () => { const start = i; while (i < source.length && /[^\s,{}]/.test(source[i]!)) i++; return source.slice(start, i); };

  function message(inPlural: boolean, nested: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => { if (text) { out.push(text); text = ''; } };
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "'") {
        const next = source[i + 1];
        if (next === "'") { text += "'"; i += 2; continue; }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          i++;
          while (i < source.length) {
            if (source[i] === "'") {
              if (source[i + 1] === "'") { text += "'"; i += 2; continue; }
              i++; break;
            }
            text += source[i++];
          }
          continue;
        }
        text += ch; i++; continue;
      }
      if (ch === '{') { flush(); i++; out.push(argument()); continue; }
      if (ch === '}') { if (nested) break; fail('Unmatched }'); }
      if (ch === '#' && inPlural) { flush(); out.push({ kind: 'pound' }); i++; continue; }
      text += ch; i++;
    }
    flush();
    return out;
  }

  function options(inPlural: boolean): Record<string, Node[]> {
    const out: Record<string, Node[]> = {};
    for (;;) {
      ws();
      if (source[i] === '}') { i++; break; }
      const key = word();
      if (!key) fail('Missing option key');
      ws();
      if (source[i] !== '{') fail(`Missing { after option "${key}"`);
      i++;
      out[key] = message(inPlural, true);
      if (source[i] !== '}') fail(`Unclosed option "${key}"`);
      i++;
    }
    if (!('other' in out)) fail('Missing "other" option');
    return out;
  }

  function argument(): Node {
    ws();
    const name = word();
    if (!NAME.test(name)) fail(`Bad argument name "${name}"`);
    ws();
    if (source[i] === '}') { i++; return { kind: 'arg', name }; }
    if (source[i] !== ',') fail('Expected , or }');
    i++; ws();
    const type = word();
    ws();
    if (type === 'number') {
      if (source[i] !== '}') fail('number takes no style here');
      i++;
      return { kind: 'arg', name };
    }
    if (type !== 'plural' && type !== 'select') fail(`Unsupported type "${type}"`);
    if (source[i] !== ',') fail('Expected , after type');
    i++;
    const opts = options(type === 'plural');
    return type === 'plural' ? { kind: 'plural', name, options: opts } : { kind: 'select', name, options: opts };
  }

  const nodes = message(false, false);
  if (i < source.length) fail('Trailing input');
  return nodes;
}

const parsed = new Map<string, Node[]>();
function compile(source: string): Node[] {
  let nodes = parsed.get(source);
  if (!nodes) { nodes = parse(source); parsed.set(source, nodes); }
  return nodes;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
function numberFormat(locale: string): Intl.NumberFormat {
  let f = numberFormats.get(locale);
  if (!f) { f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }); numberFormats.set(locale, f); }
  return f;
}
function plural(locale: string): Intl.PluralRules {
  let r = pluralRules.get(locale);
  if (!r) { r = new Intl.PluralRules(locale); pluralRules.set(locale, r); }
  return r;
}

function render(nodes: readonly Node[], locale: string, vars: MessageVars, pound: number | null): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') { out += node; continue; }
    if (node.kind === 'pound') { out += pound === null ? '#' : numberFormat(locale).format(pound); continue; }
    const value = vars[node.name];
    if (node.kind === 'arg') {
      out += value === undefined ? `{${node.name}}` : typeof value === 'number' ? numberFormat(locale).format(value) : value;
      continue;
    }
    if (node.kind === 'plural') {
      const n = Number(value);
      const exact = node.options[`=${n}`];
      const branch = exact ?? (Number.isFinite(n) ? node.options[plural(locale).select(n)] : undefined) ?? node.options.other!;
      out += render(branch, locale, vars, Number.isFinite(n) ? n : null);
      continue;
    }
    const branch = node.options[String(value)] ?? node.options.other!;
    out += render(branch, locale, vars, pound);
  }
  return out;
}

/** Format one message. `intlLocale` is a BCP 47 tag such as "tr-TR". Throws MessageSyntaxError on a malformed message. */
export function formatMessage(source: string, intlLocale: string, vars: MessageVars = {}): string {
  return render(compile(source), intlLocale, vars, null);
}

/** Argument names a message uses (plural/select selectors included), sorted. For catalog consistency tests. */
export function messageArguments(source: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string' || node.kind === 'pound') continue;
      names.add(node.name);
      if (node.kind === 'plural' || node.kind === 'select') for (const branch of Object.values(node.options)) walk(branch);
    }
  };
  walk(compile(source));
  return [...names].sort();
}

/** Tag names used as `<tag>…</tag>` in a message, sorted (rich text). */
export function messageTags(source: string): string[] {
  return [...new Set([...source.matchAll(/<([a-z][a-zA-Z0-9]*)>/g)].map(m => m[1]!))].sort();
}

/**
 * Split formatted text on flat `<tag>chunk</tag>` pairs (no nesting) and map each pair through `tags`.
 * Unknown tags are kept as their inner text, so a translation can never inject markup.
 */
export function splitTags<T>(text: string, tags: Readonly<Record<string, (chunk: string) => T>>): Array<string | T> {
  const out: Array<string | T> = [];
  const re = /<([a-z][a-zA-Z0-9]*)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index! > last) out.push(text.slice(last, match.index));
    const render = tags[match[1]!];
    out.push(render ? render(match[2]!) : match[2]!);
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

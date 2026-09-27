import registry from './author-aliases.json';

/** Only confirmed aliases identify a person; no fuzzy transliteration or surname-only merging. */
export function cleanAuthorText(value: string): string {
  const named: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
  }).normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export function authorKey(value: string): string {
  return cleanAuthorText(value).toLocaleLowerCase('ru').replace(/ё/g, 'е')
    .normalize('NFD').replace(/\p{M}/gu, '').replace(/[’ʼ]/g, "'");
}

const aliases = new Map<string, string>();
for (const person of registry) for (const alias of [person.name, ...person.aliases]) {
  const key = authorKey(alias);
  const previous = aliases.get(key);
  if (previous && previous !== person.name) throw new Error(`Ambiguous author alias: ${alias}`);
  aliases.set(key, person.name);
}

export function authorNames(value: string | null | undefined): string[] {
  const text = cleanAuthorText((value ?? '').replace(/\r?\n/g, ';'));
  if (!text) return [];
  // Whole-field match first: a verified inverted name may itself contain a comma.
  const whole = aliases.get(authorKey(text));
  if (whole) return [whole];
  const parts = text.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const inverted = i + 1 < parts.length ? aliases.get(authorKey(`${parts[i]}, ${parts[i + 1]}`)) : undefined;
    names.push(inverted ?? aliases.get(authorKey(parts[i]!)) ?? parts[i]!);
    if (inverted) i++;
  }
  return [...new Map(names.map((name) => [authorKey(name), name])).values()];
}

export const normalizeAuthors = (value: string | null | undefined): string => authorNames(value).join(', ');

/** Library sources explicitly use surname-first notation; ordinary lists must not be reversed. */
export function bibliographicAuthor(value: string): string {
  const cleaned = cleanAuthorText(value).replace(/\s*\([^)]*\)/g, '').replace(/,\s*\d{4}(?:-\d{0,4})?\s*$/, '');
  const known = aliases.get(authorKey(cleaned));
  if (known) return known;
  const parts = cleaned.split(',').map((s) => s.trim());
  return normalizeAuthors(parts.length === 2 && parts.every(Boolean) ? `${parts[1]} ${parts[0]}` : cleaned);
}

export function authorSurname(value: string, fallback = ''): string {
  const first = authorNames(value)[0];
  if (!first) return fallback;
  const words = first.split(' ');
  // IV is a generational suffix, not Tynion's surname or the catalogue letter.
  if (words.length > 1 && /^(?:[IVX]+|Jr\.?|Sr\.?)$/i.test(words.at(-1)!)) words.pop();
  return words.at(-1) ?? fallback;
}

export function matchesAuthor(value: string, filter: string): boolean {
  const names = new Set(authorNames(value).map(authorKey));
  const requested = authorNames(filter);
  return requested.length > 0 && requested.every((name) => names.has(authorKey(name)));
}

export function authorFacets(rows: Array<{ authors: string }>): Array<{ value: string; count: number }> {
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of rows) for (const name of authorNames(row.authors)) {
    const key = authorKey(name);
    const entry = counts.get(key) ?? { value: name, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'));
}

const words = (s: string) => authorKey(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const searchAliases = [...aliases].map(([alias, name]) => ({ words: words(alias), name }));

/** Search accepts full names, surnames and prefixes; identity matching above stays exact. */
export function authorSearchAlternatives(input: string): string[] {
  const tokens = words(input);
  let variants = [''];
  let changed = false;
  for (let i = 0; i < tokens.length;) {
    let consumed = 0;
    const names = new Set<string>();
    for (const alias of searchAliases) for (let start = 0; start < alias.words.length; start++) {
      let length = 0;
      while (i + length < tokens.length && start + length < alias.words.length) {
        const needle = tokens[i + length]!;
        const candidate = alias.words[start + length]!;
        if (!candidate.startsWith(needle) || (length === 0 && needle.length < 3)) break;
        length++;
        if (needle !== candidate) break;
      }
      if (length > consumed) { consumed = length; names.clear(); }
      if (length && length === consumed) names.add(alias.name);
    }
    const choices = consumed ? [...names] : [tokens[i]!];
    variants = variants.flatMap((prefix) => choices.map((choice) => `${prefix} ${choice}`.trim())).slice(0, 32);
    changed ||= consumed > 0;
    i += consumed || 1;
  }
  return [...new Set([input, ...(changed ? variants : [])])];
}

import { z } from 'zod';

const number = z.number().int().min(1).max(1000);
export const seriesVolume = z.object({ number, part: number.nullable().default(null), title: z.string().trim().min(1).max(250) });
export const volumeKey = (v: { number: number; part?: number | null }) => `${v.number}${v.part == null ? '' : `.${v.part}`}`;
export const seriesReference = z.object({
  name: z.string().trim().min(1).max(160),
  publication: z.enum(['finished', 'ongoing', 'untranslated', 'unknown']),
  volumes: z.array(seriesVolume).max(1000),
  sources: z.array(z.url().refine(v => /^https?:\/\//.test(v))).max(20).default([]),
  checkedAt: z.iso.date().nullable().default(null),
  note: z.string().trim().max(2000).default(''),
  // Verified contents of an omnibus whose numbering differs from Russian volumes.
  coverage: z.record(z.string(), z.array(z.string().regex(/^\d+(\.\d+)?$/)).max(1000)).default({}),
}).superRefine((r, ctx) => {
  const keys = r.volumes.map(volumeKey);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Номера книг повторяются' });
  if (['finished', 'ongoing'].includes(r.publication) && !keys.length) ctx.addIssue({ code: 'custom', message: 'Укажите состав серии' });
  if (r.publication === 'untranslated' && (keys.length || !r.checkedAt || !r.sources.length || !r.note)) ctx.addIssue({ code: 'custom', message: 'Для поиска без русского издания укажите дату, источники и пояснение; список русских томов должен быть пустым' });
  for (const v of r.volumes) if (v.part != null && keys.includes(String(v.number))) ctx.addIssue({ code: 'custom', message: 'Укажите либо книгу целиком, либо её части' });
  for (const targets of Object.values(r.coverage)) if (targets.some(k => !keys.includes(k))) ctx.addIssue({ code: 'custom', message: 'Состав сборника ссылается на отсутствующий том' });
});
export type SeriesReference = z.infer<typeof seriesReference>;
export const seriesPreference = z.object({
  name: z.string().trim().min(1).max(160),
  following: z.boolean(),
});
export type SeriesPreference = z.infer<typeof seriesPreference>;
export type SeriesBook = {
  id: number; isbn: string | null; title: string; series: string | null;
  seriesOrder: number | null; seriesEnd: number | null; seriesPart?: number | null; tags: string[];
};
export type SeriesStatus = 'complete' | 'current' | 'missing' | 'untranslated' | 'unknown';
export const SERIES_STATUS: Record<SeriesStatus, string> = {
  complete: 'Собрана', current: 'Всё вышедшее собрано', missing: 'Не хватает', unknown: 'Нужно уточнить',
  untranslated: 'Русское издание не найдено',
};
export type SeriesSummary = {
  name: string; status: SeriesStatus; reference: SeriesReference | null;
  owned: number; total: number | null; books: SeriesBook[];
  volumes: Array<z.infer<typeof seriesVolume> & { key: string; bookIds: number[] }>;
  missing: Array<{ key: string; title: string }>;
  gaps: number[]; unplaced: SeriesBook[];
};
export type SeriesEntry = SeriesSummary & { following: boolean };

/** Compare works, not physical copies; never infer the end of a series from the shelf. */
export function summarizeSeries(name: string, books: SeriesBook[], reference: SeriesReference | null): SeriesSummary {
  const members = books.filter(b => b.series === name);
  if (reference?.publication === 'untranslated') return {
    name, status: 'untranslated', reference, owned: 0, total: null, books: members,
    volumes: [], missing: [], gaps: [], unplaced: [],
  };
  const volumes = (reference?.volumes ?? []).map(v => ({ ...v, key: volumeKey(v), bookIds: [] as number[] }))
    .sort((a, b) => a.number - b.number || (a.part ?? 0) - (b.part ?? 0));
  const unplaced: SeriesBook[] = [];
  const numbered = new Set<number>();
  for (const b of members) {
    const start = b.seriesOrder, end = b.seriesEnd ?? start;
    const explicit = b.isbn ? reference?.coverage[b.isbn] : undefined;
    // Foreign collected editions can use a different volume numbering.
    const canUseNumbers = !b.tags.includes('на английском');
    const validRange = canUseNumbers && start != null && end != null && start > 0 && end >= start && end <= 1000;
    if (validRange && b.seriesPart == null) for (let n = start; n <= end; n++) numbered.add(n);
    const matches = volumes.filter(v => explicit ? explicit.includes(v.key) : validRange && (
      b.seriesPart != null ? v.number === start && v.part === b.seriesPart
        : v.number >= start && v.number <= end && v.part == null
    ));
    for (const v of matches) v.bookIds.push(b.id);
    const outside = validRange && volumes.length > 0 && b.seriesPart == null &&
      Array.from({ length: end - start + 1 }, (_, i) => start + i).some(n => !matches.some(v => v.number === n));
    if (!matches.length || (!explicit && outside)) unplaced.push(b);
  }
  const missing = volumes.filter(v => !v.bookIds.length).map(({ key, title }) => ({ key, title }));
  const known = reference != null && reference.volumes.length > 0 && reference.publication !== 'unknown';
  const status: SeriesStatus = !known || unplaced.length ? 'unknown' : missing.length ? 'missing'
    : reference.publication === 'finished' ? 'complete' : 'current';
  const max = Math.max(0, ...numbered);
  const gaps = known ? [] : Array.from({ length: max }, (_, i) => i + 1).filter(n => !numbered.has(n));
  return { name, status, reference, owned: volumes.filter(v => v.bookIds.length).length, total: known ? volumes.length : null,
    books: members, volumes, missing, gaps, unplaced };
}

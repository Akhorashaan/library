import { z } from 'zod';

/* ─────────────────────────────────────────────────────────────────────────
   Границы API. Один источник и для валидации на сервере, и для типов
   на клиенте — поэтому лежит отдельно от обеих сторон.
   ───────────────────────────────────────────────────────────────────────── */

/** Статус чтения. Хранится строкой: в SQLite это читаемо глазами при отладке. */
export const ReadingStatus = z.enum(['queued', 'reading', 'read', 'abandoned', 'none']);
export type ReadingStatus = z.infer<typeof ReadingStatus>;

export const READING_STATUS_LABEL: Record<ReadingStatus, string> = {
  none: 'Не начата',
  queued: 'В очереди',
  reading: 'Читаю',
  read: 'Прочитано',
  abandoned: 'Брошена',
};

/** Чем упорядочен каталог. От этого же зависит, по чему он разбит на секции. */
export const SortKey = z.enum(['series', 'author', 'title', 'year', 'added']);
export type SortKey = z.infer<typeof SortKey>;

export const SORT_LABEL: Record<SortKey, string> = {
  series: 'По сериям и порядку чтения',
  author: 'По автору',
  title: 'По названию',
  year: 'По году',
  added: 'Недавно добавленные',
};

/** Чистый ISBN: только цифры и возможная X в ISBN-10. */
export const isbnSchema = z
  .string()
  .transform((s) => s.replace(/[^0-9Xx]/g, '').toUpperCase())
  .refine((s) => s.length === 10 || s.length === 13, 'ISBN должен быть из 10 или 13 знаков');

export const tagName = z.string().trim().min(1).max(60).transform((s) => s.normalize('NFC').toLocaleLowerCase('ru').replace(/\s+/g, ' '));
export const bookInput = z.object({
  isbn: z.string().nullable().optional(),
  title: z.string().min(1, 'Без названия книгу не найти'),
  authors: z.string().default(''),
  publisher: z.string().nullable().optional(),
  year: z.number().int().min(1400).max(2200).nullable().optional(),
  pages: z.number().int().positive().nullable().optional(),
  binding: z.string().nullable().optional(),
  genre: z.string().nullable().optional(),
  series: z.string().trim().max(160).transform((s) => s || null).nullable().optional(),
  seriesOrder: z.number().int().positive().nullable().optional(),
  seriesEnd: z.number().int().positive().nullable().optional(),
  tags: z.array(tagName).max(30).transform((tags) => [...new Set(tags)]).optional(),
  annotation: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  /** Пусто — книга дома. Иначе имя того, у кого она сейчас. */
  lentTo: z.string().nullable().optional(),
  lentAt: z.string().nullable().optional(),
  status: ReadingStatus.default('none'),
  progress: z.number().int().min(0).nullable().optional(),
  note: z.string().nullable().optional(),
});
export type BookInput = z.infer<typeof bookInput>;

export const bookPatch = bookInput.partial();
export type BookPatch = z.infer<typeof bookPatch>;

export const book = bookInput.extend({
  id: z.number().int(),
  shelfmark: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  queuePos: z.number().nullable(),
});
export type Book = z.infer<typeof book>;

/**
 * Фильтры каталога. Пустые значения отбрасываются на клиенте, поэтому
 * сюда приходит только то, что человек действительно выбрал.
 */
export const bookQuery = z.object({
  q: z.string().optional(),
  status: ReadingStatus.optional(),
  genre: z.string().optional(),
  author: z.string().optional(),
  publisher: z.string().optional(),
  series: z.string().optional(),
  tags: z.preprocess((v) => typeof v === 'string' ? [v] : v, z.array(tagName).max(30).optional()),
  missing: z.enum(['series', 'tags', 'authors', 'pages']).optional(),
  /** Книги не дома — отдельная ось: для домашней библиотеки это больной вопрос. */
  lent: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  sort: SortKey.default('series'),
  limit: z.coerce.number().int().min(1).max(500).default(300),
  offset: z.coerce.number().int().min(0).default(0),
});
export type BookQuery = z.infer<typeof bookQuery>;

/** Что вернул каскад источников до того, как книга попала в каталог. */
export const lookupResult = z.object({
  isbn: z.string(),
  found: z.boolean(),
  title: z.string().nullable(),
  authors: z.string().nullable(),
  publisher: z.string().nullable(),
  year: z.number().nullable(),
  pages: z.number().nullable(),
  binding: z.string().nullable(),
  genre: z.string().nullable(),
  annotation: z.string().nullable(),
  coverUrl: z.string().nullable(),
  /** Какой источник дал какое поле — видно в интерфейсе, чинит доверие к данным. */
  sources: z.record(z.string(), z.string()),
  tookMs: z.number(),
  alreadyInLibrary: z.number().int().nullable(),
  /** Сколько раз этот ISBN уже откладывали. null — в стопке его нет. */
  pendingAttempts: z.number().int().nullable(),
});
export type LookupResult = z.infer<typeof lookupResult>;

export const reorderInput = z.object({ ids: z.array(z.number().int()) });

/**
 * ISBN, которого не знает ни один источник. Откладывается в стопку «на разбор»,
 * чтобы не потеряться: такие книги заводятся руками, когда дойдут руки.
 */
export const unresolved = z.object({
  isbn: z.string(),
  firstSeen: z.string(),
  lastTried: z.string(),
  /** Сколько раз пытались найти. Источники пополняются — вторая попытка через месяц имеет смысл. */
  attempts: z.number().int(),
  note: z.string().nullable(),
});
export type Unresolved = z.infer<typeof unresolved>;

export const unresolvedInput = z.object({
  isbn: z.string(),
  note: z.string().nullable().optional(),
});

const countedValue = z.object({ value: z.string(), count: z.number() });

export const statsSchema = z.object({
  total: z.number(),
  reading: z.number(),
  queued: z.number(),
  read: z.number(),
  abandoned: z.number(),
  none: z.number(),
  lent: z.number(),
  readThisYear: z.number(),
  /** Сколько ISBN ждут разбора. */
  unresolved: z.number(),
  /** Значения для фильтров — сразу с числом книг, чтобы не выбирать пустое. */
  genres: z.array(countedValue),
  authors: z.array(countedValue),
  publishers: z.array(countedValue),
  series: z.array(countedValue),
  tags: z.array(countedValue),
  years: z.object({ min: z.number().nullable(), max: z.number().nullable() }),
});
export type Stats = z.infer<typeof statsSchema>;

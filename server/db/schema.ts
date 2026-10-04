import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Произведение и издание. Всё, что напечатано в книге и одинаково у всех,
 * у кого стоит тот же томик.
 */
export const books = sqliteTable(
  'books',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    isbn: text('isbn'),
    title: text('title').notNull(),
    authors: text('authors').notNull().default(''),
    publisher: text('publisher'),
    year: integer('year'),
    pages: integer('pages'),
    binding: text('binding'),
    genre: text('genre'),
    series: text('series'),
    seriesOrder: integer('series_order'),
    seriesEnd: integer('series_end'),
    seriesPart: integer('series_part'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    annotation: text('annotation'),
    /** Локальный путь вида /covers/9785…jpg — на чужой CDN не ссылаемся. */
    coverUrl: text('cover_url'),
    /** Какие источники дали данные; JSON {поле: источник}. */
    source: text('source'),
    /** Библиотечный шифр из фамилии автора: ША 12. */
    shelfmark: text('shelfmark').notNull().default(''),
    /** Фамилия + имя в нижнем регистре: каталог упорядочен по фамилии. */
    sortKey: text('sort_key').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('books_isbn_uq').on(t.isbn),
    index('books_title_idx').on(t.title),
    index('books_sort_idx').on(t.sortKey),
  ]
);

/**
 * Физический экземпляр. Отдельно от книги, потому что дома бывает два издания
 * одного произведения, а «кому я её отдал» относится к томику, а не к тексту.
 */
export const copies = sqliteTable(
  'copies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    condition: text('condition'),
    /** Пусто — книга дома. Иначе имя того, у кого она сейчас. */
    lentTo: text('lent_to'),
    lentAt: text('lent_at'),
    acquiredAt: text('acquired_at'),
  },
  (t) => [index('copies_book_idx').on(t.bookId), index('copies_lent_idx').on(t.lentTo)]
);

/** Чтение: у одного читателя одна запись на книгу. */
export const reading = sqliteTable(
  'reading',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('none'),
    /** Страница, на которой остановился. */
    progress: integer('progress'),
    note: text('note'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    /** Позиция в очереди чтения; NULL — не в очереди. */
    queuePos: integer('queue_pos'),
  },
  (t) => [
    uniqueIndex('reading_book_uq').on(t.bookId),
    index('reading_status_idx').on(t.status),
    index('reading_queue_idx').on(t.queuePos),
  ]
);

/**
 * Стопка «на разбор»: ISBN, которые каскад не опознал.
 *
 * Ключ — сам ISBN, поэтому одинаковые физически не могут накопиться:
 * повторный скан не добавляет строку, а обновляет счётчик попыток.
 */
export const unresolved = sqliteTable('unresolved', {
  isbn: text('isbn').primaryKey(),
  firstSeen: text('first_seen').notNull(),
  lastTried: text('last_tried').notNull(),
  attempts: integer('attempts').notNull().default(1),
  note: text('note'),
});

/** Кэш каскада: повторный скан того же ISBN не должен ходить в сеть. */
export const lookupCache = sqliteTable('lookup_cache', {
  isbn: text('isbn').primaryKey(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

export type BookRow = typeof books.$inferSelect;
export const seriesPreferences = sqliteTable('series_preferences', {
  name: text('name').primaryKey(),
  following: integer('following', { mode: 'boolean' }).notNull().default(true),
});
export type CopyRow = typeof copies.$inferSelect;
export type ReadingRow = typeof reading.$inferSelect;

/** Journal entries do not create catalogue books or physical copies. */
export const externalReading = sqliteTable('external_reading', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  authors: text('authors').notNull().default(''),
  finishedAt: text('finished_at'),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, sqlite, toFtsQuery } from './db/index.js';
import { books, copies, reading, unresolved, type BookRow, type CopyRow, type ReadingRow } from './db/schema.js';
import { bookInput, bookPatch, bookQuery, isbnSchema, reorderInput, unresolvedInput } from '../shared/schema.js';
import { lookupIsbn } from './metadata/index.js';
import { shelfmark, sortKey } from './metadata/normalize.js';
import { fetchCover } from './covers.js';
import { authorFacets, authorSearchAlternatives, matchesAuthor, normalizeAuthors } from '../shared/authors.js';
import { registerSeriesRoutes } from './series.js';

/**
 * Снаружи книга — один плоский объект. Три таблицы внутри нужны, чтобы
 * «кому отдал» относилось к томику, а не к тексту, но клиенту про это знать
 * незачем: он показывает карточку, а не схему.
 */
function flatten(b: BookRow, c: CopyRow | undefined, r: ReadingRow | undefined) {
  return {
    id: b.id,
    isbn: b.isbn,
    title: b.title,
    authors: b.authors,
    publisher: b.publisher,
    year: b.year,
    pages: b.pages,
    binding: b.binding,
    genre: b.genre,
    series: b.series,
    seriesOrder: b.seriesOrder,
    seriesEnd: b.seriesEnd,
    seriesPart: b.seriesPart,
    tags: b.tags,
    annotation: b.annotation,
    coverUrl: b.coverUrl,
    source: b.source,
    shelfmark: b.shelfmark,
    createdAt: b.createdAt,
    condition: c?.condition ?? null,
    lentTo: c?.lentTo ?? null,
    lentAt: c?.lentAt ?? null,
    status: (r?.status ?? 'none') as string,
    progress: r?.progress ?? null,
    note: r?.note ?? null,
    startedAt: r?.startedAt ?? null,
    finishedAt: r?.finishedAt ?? null,
    queuePos: r?.queuePos ?? null,
  };
}

function loadBooks(ids: number[]) {
  if (!ids.length) return [];
  const bs = db.select().from(books).where(inArray(books.id, ids)).all();
  const cs = db.select().from(copies).where(inArray(copies.bookId, ids)).all();
  const rs = db.select().from(reading).where(inArray(reading.bookId, ids)).all();
  const cBy = new Map(cs.map((c) => [c.bookId, c]));
  const rBy = new Map(rs.map((r) => [r.bookId, r]));
  const bBy = new Map(bs.map((b) => [b.id, b]));
  // Порядок задаёт вызывающий: у поиска он по релевантности, у очереди — свой.
  return ids.flatMap((id) => {
    const b = bBy.get(id);
    return b ? [flatten(b, cBy.get(id), rBy.get(id))] : [];
  });
}

const nowIso = () => new Date().toISOString();

function validateOrganization(d: { series?: string | null; seriesOrder?: number | null; seriesEnd?: number | null; seriesPart?: number | null }) {
  if (!d.series && (d.seriesOrder != null || d.seriesEnd != null)) return 'Укажите серию для номера книги';
  if (d.seriesEnd != null && (d.seriesOrder == null || d.seriesEnd < d.seriesOrder)) return 'Конец диапазона должен быть не меньше первого номера';
  if (d.seriesPart != null && (!d.series || d.seriesOrder == null || (d.seriesEnd != null && d.seriesEnd !== d.seriesOrder))) return 'Часть можно указать только для одной книги с номером в серии';
  return null;
}

/** Выбранный порядок действует и при поиске, чтобы серии не перемешивались. */
const ORDER_BY: Record<string, string> = {
  series: "b.series IS NULL, b.series COLLATE NOCASE, b.series_order IS NULL, b.series_order, b.sort_key, b.title, b.id",
  author: "b.sort_key = '', b.sort_key, b.year, b.title COLLATE NOCASE",
  title: 'b.title COLLATE NOCASE',
  year: 'b.year IS NULL, b.year DESC, b.authors COLLATE NOCASE',
  added: 'b.created_at DESC',
};

export async function registerRoutes(app: FastifyInstance) {
  await registerSeriesRoutes(app);
  /* ───────────────────────────── каталог ───────────────────────────── */

  app.get('/api/books', async (req, reply) => {
    const parsed = bookQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { q, status, genre, author, publisher, series, tags, missing, lent, yearFrom, yearTo, sort, limit, offset } = parsed.data;
    if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) return reply.code(400).send({ error: 'Начальный год больше конечного' });

    // Фильтры собираются в общий набор условий — он одинаков и для поиска,
    // и для обычного просмотра, чтобы выдача не расходилась между режимами.
    const where: string[] = [];
    const args: unknown[] = [];
    if (series) { where.push('b.series = ?'); args.push(series); }
    for (const tag of tags ?? []) {
      where.push('EXISTS (SELECT 1 FROM json_each(b.tags) t WHERE t.value = ?)');
      args.push(tag);
    }
    if (missing === 'series') where.push('b.series IS NULL');
    if (missing === 'tags') where.push('json_array_length(b.tags) = 0');
    if (missing === 'authors') where.push("trim(b.authors) = ''");
    if (missing === 'pages') where.push('b.pages IS NULL');

    if (status) {
      where.push("coalesce(r.status, 'none') = ?");
      args.push(status);
    }
    if (genre) {
      where.push('b.genre = ?');
      args.push(genre);
    }
    if (author) {
      const values = (sqlite.prepare('SELECT DISTINCT authors FROM books').all() as { authors: string }[])
        .filter((row) => matchesAuthor(row.authors, author)).map((row) => row.authors);
      if (!values.length) return [];
      where.push(`b.authors IN (${values.map(() => '?').join(',')})`);
      args.push(...values);
    }
    if (publisher) {
      where.push('b.publisher = ?');
      args.push(publisher);
    }
    if (lent) where.push("c.lent_to IS NOT NULL AND c.lent_to <> ''");
    if (yearFrom !== undefined) {
      where.push('b.year >= ?');
      args.push(yearFrom);
    }
    if (yearTo !== undefined) {
      where.push('b.year <= ?');
      args.push(yearTo);
    }

    const joins = `
      LEFT JOIN reading r ON r.book_id = b.id
      LEFT JOIN copies  c ON c.book_id = b.id`;
    const cond = where.length ? `AND ${where.join(' AND ')}` : '';

    let ids: number[];

    if (q?.trim()) {
      const fts = authorSearchAlternatives(q).map(toFtsQuery).filter(Boolean).map((v) => `(${v})`).join(' OR ');
      if (!fts) return [];
      // bm25 — встроенное ранжирование FTS5; чем меньше, тем релевантнее.
      const rows = sqlite
        .prepare(
          `SELECT b.id FROM books_fts f JOIN books b ON b.id = f.rowid ${joins}
            WHERE books_fts MATCH ? ${cond}
            ORDER BY ${ORDER_BY[sort]}, bm25(books_fts) LIMIT ? OFFSET ?`
        )
        .all(fts, ...args, limit, offset) as { id: number }[];
      ids = rows.map((r) => r.id);
    } else {
      const rows = sqlite
        .prepare(
          `SELECT b.id FROM books b ${joins}
            WHERE 1=1 ${cond}
            ORDER BY ${ORDER_BY[sort] ?? ORDER_BY.author}
            LIMIT ? OFFSET ?`
        )
        .all(...args, limit, offset) as { id: number }[];
      ids = rows.map((r) => r.id);
    }

    return loadBooks(ids);
  });

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const [book] = loadBooks([Number(req.params.id)]);
    return book ?? reply.code(404).send({ error: 'Такой книги в каталоге нет' });
  });

  app.post('/api/books', async (req, reply) => {
    const parsed = bookInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const d = parsed.data;
    d.authors = normalizeAuthors(d.authors);
    const organizationError = validateOrganization(d);
    if (organizationError) return reply.code(400).send({ error: organizationError });

    const isbn = d.isbn ? (isbnSchema.safeParse(d.isbn).data ?? null) : null;
    if (isbn) {
      const existing = db.select().from(books).where(eq(books.isbn, isbn)).get();
      if (existing) return reply.code(409).send({ error: 'Эта книга уже в каталоге', id: existing.id });
    }

    // Обложку забираем к себе до вставки: ссылка на чужой CDN протухнет.
    const coverUrl = d.coverUrl?.startsWith('http')
      ? await fetchCover(d.coverUrl, isbn ?? `t${Date.now()}`)
      : (d.coverUrl ?? null);

    const inserted = db
      .insert(books)
      .values({
        isbn,
        title: d.title,
        authors: d.authors ?? '',
        publisher: d.publisher ?? null,
        year: d.year ?? null,
        pages: d.pages ?? null,
        binding: d.binding ?? null,
        genre: d.genre ?? null,
        series: d.series ?? null,
        seriesOrder: d.seriesOrder ?? null,
        seriesEnd: d.seriesEnd ?? null,
        seriesPart: d.seriesPart ?? null,
        tags: d.tags ?? [],
        annotation: d.annotation ?? null,
        coverUrl,
        source: d.source ?? null,
        shelfmark: shelfmark(d.authors, d.title),
        sortKey: sortKey(d.authors, d.title),
        createdAt: nowIso(),
      })
      .returning()
      .get();

    db.insert(copies)
      .values({
        bookId: inserted.id,
        condition: d.condition ?? null,
        lentTo: d.lentTo ?? null,
        lentAt: d.lentAt ?? null,
        acquiredAt: nowIso(),
      })
      .run();

    db.insert(reading)
      .values({
        bookId: inserted.id,
        status: d.status ?? 'none',
        progress: d.progress ?? null,
        note: d.note ?? null,
        startedAt: d.status === 'reading' ? nowIso() : null,
        finishedAt: d.status === 'read' ? nowIso() : null,
        queuePos: d.status === 'queued' ? nextQueuePos() : null,
      })
      .run();

    // Книга заведена — из стопки «на разбор» её ISBN уходит сам, чтобы
    // не пришлось помнить про это руками.
    if (isbn) db.delete(unresolved).where(eq(unresolved.isbn, isbn)).run();

    return reply.code(201).send(loadBooks([inserted.id])[0]);
  });

  app.patch<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const parsed = bookPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const d = parsed.data;

    const current = db.select().from(books).where(eq(books.id, id)).get();
    if (!current) return reply.code(404).send({ error: 'Такой книги в каталоге нет' });
    if (d.authors !== undefined) d.authors = normalizeAuthors(d.authors);

    if (d.series === null) { d.seriesOrder = null; d.seriesEnd = null; d.seriesPart = null; }
    const organizationError = validateOrganization({ ...current, ...d });
    if (organizationError) return reply.code(400).send({ error: organizationError });

    const bookFields = ['title', 'authors', 'publisher', 'year', 'pages', 'binding', 'genre', 'annotation', 'isbn', 'series', 'seriesOrder', 'seriesEnd', 'seriesPart', 'tags'] as const;
    const bookPatchData: Record<string, unknown> = {};
    for (const f of bookFields) if (d[f] !== undefined) bookPatchData[f] = d[f];
    // Шифр выводится из автора и названия — пересчитываем, если они менялись.
    if (d.title !== undefined || d.authors !== undefined) {
      bookPatchData.shelfmark = shelfmark(d.authors ?? current.authors, d.title ?? current.title);
      bookPatchData.sortKey = sortKey(d.authors ?? current.authors, d.title ?? current.title);
    }
    if (Object.keys(bookPatchData).length) {
      db.update(books).set(bookPatchData).where(eq(books.id, id)).run();
    }

    const copyPatch: Record<string, unknown> = {};
    for (const f of ['condition', 'lentTo', 'lentAt'] as const) if (d[f] !== undefined) copyPatch[f] = d[f];
    if (Object.keys(copyPatch).length) {
      const has = db.select().from(copies).where(eq(copies.bookId, id)).get();
      if (has) db.update(copies).set(copyPatch).where(eq(copies.bookId, id)).run();
      else db.insert(copies).values({ bookId: id, ...copyPatch }).run();
    }

    const readPatch: Record<string, unknown> = {};
    for (const f of ['status', 'progress', 'note'] as const) if (d[f] !== undefined) readPatch[f] = d[f];
    if (d.status !== undefined) {
      // Даты ставим сами: пользователь меняет статус, а не заполняет журнал.
      const prev = db.select().from(reading).where(eq(reading.bookId, id)).get();
      if (d.status === 'reading' && !prev?.startedAt) readPatch.startedAt = nowIso();
      if (d.status === 'read') readPatch.finishedAt = nowIso();
      readPatch.queuePos = d.status === 'queued' ? (prev?.queuePos ?? nextQueuePos()) : null;
    }
    if (Object.keys(readPatch).length) {
      const has = db.select().from(reading).where(eq(reading.bookId, id)).get();
      if (has) db.update(reading).set(readPatch).where(eq(reading.bookId, id)).run();
      else db.insert(reading).values({ bookId: id, status: 'none', ...readPatch }).run();
    }

    return loadBooks([id])[0];
  });

  app.delete<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const hit = db.select().from(books).where(eq(books.id, id)).get();
    if (!hit) return reply.code(404).send({ error: 'Такой книги в каталоге нет' });
    db.delete(books).where(eq(books.id, id)).run(); // copies/reading уйдут каскадом
    return { ok: true };
  });

  /* ─────────────────────────── поиск по ISBN ───────────────────────── */

  app.get<{ Params: { isbn: string }; Querystring: { fresh?: string } }>(
    '/api/lookup/:isbn',
    async (req, reply) => {
      const parsed = isbnSchema.safeParse(req.params.isbn);
      if (!parsed.success) return reply.code(400).send({ error: 'Не похоже на ISBN' });
      const isbn = parsed.data;

      const already = db.select({ id: books.id }).from(books).where(eq(books.isbn, isbn)).get();
      const pending = db.select().from(unresolved).where(eq(unresolved.isbn, isbn)).get();
      const result = await lookupIsbn(isbn, { noCache: req.query.fresh === '1' });
      return { ...result, alreadyInLibrary: already?.id ?? null, pendingAttempts: pending?.attempts ?? null };
    }
  );

  /* ────────────────────────── очередь чтения ───────────────────────── */

  app.get('/api/queue', async () => {
    const rows = db
      .select({ id: reading.bookId })
      .from(reading)
      .where(and(eq(reading.status, 'queued'), isNotNull(reading.queuePos)))
      .orderBy(reading.queuePos)
      .all();
    const now = db.select({ id: reading.bookId }).from(reading).where(eq(reading.status, 'reading')).all();
    const done = db
      .select({ id: reading.bookId })
      .from(reading)
      .where(eq(reading.status, 'read'))
      .orderBy(desc(reading.finishedAt))
      .limit(12)
      .all();
    return {
      now: loadBooks(now.map((r) => r.id)),
      queue: loadBooks(rows.map((r) => r.id)),
      done: loadBooks(done.map((r) => r.id)),
    };
  });

  app.post('/api/queue/reorder', async (req, reply) => {
    const parsed = reorderInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    // Одной транзакцией: половина переставленной очереди хуже, чем неудача.
    const tx = sqlite.transaction((ids: number[]) => {
      const stmt = sqlite.prepare('UPDATE reading SET queue_pos = ? WHERE book_id = ?');
      ids.forEach((id, i) => stmt.run(i + 1, id));
    });
    tx(parsed.data.ids);
    return { ok: true };
  });

  /* ──────────────────────── стопка «на разбор» ─────────────────────── */

  app.get('/api/unresolved', async () =>
    db.select().from(unresolved).orderBy(desc(unresolved.lastTried)).all()
  );

  app.post('/api/unresolved', async (req, reply) => {
    const parsed = unresolvedInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });

    const isbnParsed = isbnSchema.safeParse(parsed.data.isbn);
    if (!isbnParsed.success) return reply.code(400).send({ error: 'Не похоже на ISBN' });
    const isbn = isbnParsed.data;

    // Книга уже в каталоге — откладывать нечего.
    const inLibrary = db.select({ id: books.id }).from(books).where(eq(books.isbn, isbn)).get();
    if (inLibrary) return reply.code(409).send({ error: 'Эта книга уже в каталоге', id: inLibrary.id });

    const now = nowIso();
    // Ключ — сам ISBN, поэтому повторный скан не плодит строку, а лишь
    // отмечает ещё одну неудачную попытку.
    db.insert(unresolved)
      .values({ isbn, firstSeen: now, lastTried: now, attempts: 1, note: parsed.data.note ?? null })
      .onConflictDoUpdate({
        target: unresolved.isbn,
        set: {
          lastTried: now,
          attempts: sql`${unresolved.attempts} + 1`,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
      })
      .run();

    return db.select().from(unresolved).where(eq(unresolved.isbn, isbn)).get();
  });

  app.patch<{ Params: { isbn: string } }>('/api/unresolved/:isbn', async (req, reply) => {
    const parsed = isbnSchema.safeParse(req.params.isbn);
    if (!parsed.success) return reply.code(400).send({ error: 'Не похоже на ISBN' });
    const note = (req.body as { note?: string | null } | undefined)?.note ?? null;
    db.update(unresolved).set({ note }).where(eq(unresolved.isbn, parsed.data)).run();
    return db.select().from(unresolved).where(eq(unresolved.isbn, parsed.data)).get() ?? reply.code(404).send({ error: 'Нет такого' });
  });

  app.delete<{ Params: { isbn: string } }>('/api/unresolved/:isbn', async (req, reply) => {
    const parsed = isbnSchema.safeParse(req.params.isbn);
    if (!parsed.success) return reply.code(400).send({ error: 'Не похоже на ISBN' });
    db.delete(unresolved).where(eq(unresolved.isbn, parsed.data)).run();
    return { ok: true };
  });

  /* ───────────────── сводка и значения для фильтров ────────────────── */

  app.get('/api/stats', async () => {
    const one = (q: string, ...args: unknown[]) => (sqlite.prepare(q).get(...args) as { n: number }).n;
    const year = new Date().getFullYear();

    // Фасеты отдаём сразу со счётчиками: выбирать фильтр, который ничего
    // не найдёт, — худший способ узнать, что в каталоге такого нет.
    const facet = (column: string) =>
      sqlite
        .prepare(
          `SELECT ${column} AS value, count(*) AS count FROM books
            WHERE ${column} IS NOT NULL AND trim(${column}) <> ''
            GROUP BY ${column} ORDER BY count DESC, value COLLATE NOCASE`
        )
        .all() as { value: string; count: number }[];

    const years = sqlite.prepare('SELECT min(year) AS min, max(year) AS max FROM books WHERE year IS NOT NULL').get() as {
      min: number | null;
      max: number | null;
    };

    return {
      total: one('SELECT count(*) n FROM books'),
      reading: one("SELECT count(*) n FROM reading WHERE status='reading'"),
      queued: one("SELECT count(*) n FROM reading WHERE status='queued'"),
      read: one("SELECT count(*) n FROM reading WHERE status='read'"),
      abandoned: one("SELECT count(*) n FROM reading WHERE status='abandoned'"),
      none: one(
        `SELECT count(*) n FROM books b LEFT JOIN reading r ON r.book_id = b.id
          WHERE coalesce(r.status,'none') = 'none'`
      ),
      lent: one("SELECT count(*) n FROM copies WHERE lent_to IS NOT NULL AND lent_to <> ''"),
      readThisYear: one("SELECT count(*) n FROM reading WHERE status='read' AND finished_at LIKE ?", `${year}%`),
      unresolved: one('SELECT count(*) n FROM unresolved'),
      genres: facet('genre'),
      authors: authorFacets(sqlite.prepare('SELECT authors FROM books').all() as { authors: string }[]),
      publishers: facet('publisher'),
      series: facet('series'),
      tags: sqlite.prepare('SELECT t.value, count(*) AS count FROM books b, json_each(b.tags) t GROUP BY t.value ORDER BY count DESC, t.value').all(),
      years: { min: years.min ?? null, max: years.max ?? null },
    };
  });
}

/** Новая книга встаёт в конец очереди. */
function nextQueuePos(): number {
  const r = sqlite.prepare('SELECT coalesce(max(queue_pos), 0) + 1 AS n FROM reading').get() as { n: number };
  return r.n;
}

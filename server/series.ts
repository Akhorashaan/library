import type { FastifyInstance } from 'fastify';
import { db, sqlite } from './db/index.js';
import { books } from './db/schema.js';
import { seriesPreference, seriesReference, summarizeSeries, type SeriesReference } from '../shared/series.js';
import catalogue from '../shared/series-catalogue.json' with { type: 'json' };

const defaults = catalogue.map(r => seriesReference.parse(r));
export async function registerSeriesRoutes(app: FastifyInstance) {
  const references = () => {
    const refs = new Map<string, SeriesReference>(defaults.map(r => [r.name, r]));
    for (const row of sqlite.prepare('SELECT payload FROM series_references').all() as { payload: string }[]) {
      const r = seriesReference.parse(JSON.parse(row.payload)); refs.set(r.name, r);
    }
    return refs;
  };
  app.get('/api/series', async () => {
    const library = db.select({ id: books.id, isbn: books.isbn, title: books.title, series: books.series,
      seriesOrder: books.seriesOrder, seriesEnd: books.seriesEnd, seriesPart: books.seriesPart, tags: books.tags }).from(books).all();
    const refs = references();
    const preferences = new Map((sqlite.prepare('SELECT name, following FROM series_preferences').all() as { name: string; following: number }[])
      .map(r => [r.name, Boolean(r.following)]));
    return [...new Set(library.map(b => b.series).filter((s): s is string => Boolean(s)))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map(name => ({ ...summarizeSeries(name, library, refs.get(name) ?? null), following: preferences.get(name) ?? true }));
  });
  app.put('/api/series/preference', async (req, reply) => {
    const result = seriesPreference.safeParse(req.body);
    if (!result.success) return reply.code(400).send({ error: 'Укажите название серии и нужно ли за ней следить' });
    const preference = result.data;
    if (!sqlite.prepare('SELECT 1 FROM books WHERE series=?').get(preference.name)) return reply.code(404).send({ error: 'Такой серии в каталоге нет' });
    sqlite.prepare('INSERT INTO series_preferences(name,following) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET following=excluded.following')
      .run(preference.name, Number(preference.following));
    return preference;
  });
  app.put('/api/series/reference', async (req, reply) => {
    const result = seriesReference.safeParse(req.body);
    if (!result.success) return reply.code(400).send({ error: result.error.issues.map(i => i.message).join('; ') });
    const r = result.data;
    if (!sqlite.prepare('SELECT 1 FROM books WHERE series=?').get(r.name)) return reply.code(404).send({ error: 'Такой серии в каталоге нет' });
    sqlite.prepare('INSERT INTO series_references(name,payload) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET payload=excluded.payload')
      .run(r.name, JSON.stringify(r));
    return r;
  });
}

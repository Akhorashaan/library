import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { authorNames, authorSurname, bibliographicAuthor, matchesAuthor, normalizeAuthors } from '../shared/authors.js';
import { reconcileAuthors } from '../server/metadata/reconcile-authors.js';

test('verified identities, Unicode cleanup, suffixes and distinct coauthors', () => {
  assert.equal(normalizeAuthors('  James  Tynion Ⅳ&#x20;'), 'Джеймс Тайнион IV');
  assert.equal(normalizeAuthors('ДЖЕЙМС ТАЙНИОН IV&nbsp;'), 'Джеймс Тайнион IV');
  assert.equal(normalizeAuthors('Tynion, James IV'), 'Джеймс Тайнион IV');
  assert.equal(normalizeAuthors('Sean Gordon Murphy'), 'Шон Мерфи');
  assert.equal(normalizeAuthors('Шон Мёрфи'), 'Шон Мерфи');
  assert.deepEqual(authorNames('James Tynion IV, Джеймс Тайнион IV, Alvaro Martinez Bueno'), ['Джеймс Тайнион IV', 'Álvaro Martínez Bueno']);
  assert.equal(normalizeAuthors('Neil Gaiman, Terry Pratchett'), 'Neil Gaiman, Terry Pratchett');
  assert.deepEqual(authorNames('Neil Gaiman; Terry Pratchett\nAlan Moore'), ['Neil Gaiman', 'Terry Pratchett', 'Alan Moore']);
  assert.equal(bibliographicAuthor('Пелевин, Виктор (VerfasserIn)'), 'Виктор Пелевин');
  assert.equal(authorSurname('James Tynion IV, Alvaro Martino Bueno'), 'Тайнион');
  assert.equal(matchesAuthor('Джеймс Тайнион IV, Álvaro Martínez Bueno', 'James Tynion IV'), true);
  assert.equal(matchesAuthor('James Tynion III', 'James Tynion IV'), false);
  assert.equal(matchesAuthor('Иван Иванов', 'Пётр Иванов'), false);
  assert.equal(normalizeAuthors('James Tynion V'), 'James Tynion V');
});

test('existing library, author facets/search, future writes, old ISBN cache and idempotent reconciliation', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'kartoteka-authors-'));
  process.env.DB_PATH = join(temp, 'test.db');
  const original = new Database('data/kartoteka.db', { readonly: true });
  await original.backup(process.env.DB_PATH);
  original.close();
  const { sqlite, initSchema } = await import('../server/db/index.js');
  const { registerRoutes } = await import('../server/routes.js');
  const app = Fastify();
  try {
    initSchema();
    const before = sqlite.prepare('SELECT * FROM books ORDER BY id').all() as Record<string, unknown>[];
    const reading = sqlite.prepare('SELECT * FROM reading ORDER BY id').all();
    const copies = sqlite.prepare('SELECT * FROM copies ORDER BY id').all();
    reconcileAuthors(sqlite, true);
    assert.deepEqual(reconcileAuthors(sqlite, true), { books: [], cache: [] });
    const after = sqlite.prepare('SELECT * FROM books ORDER BY id').all() as Record<string, unknown>[];
    for (let i = 0; i < before.length; i++) for (const key of Object.keys(before[i]!)) {
      if (!['authors', 'sort_key', 'shelfmark'].includes(key)) assert.deepEqual(after[i]![key], before[i]![key]);
    }
    assert.deepEqual(sqlite.prepare('SELECT * FROM reading ORDER BY id').all(), reading);
    assert.deepEqual(sqlite.prepare('SELECT * FROM copies ORDER BY id').all(), copies);
    await registerRoutes(app);
    const get = async (params: Record<string, string>) => {
      const res = await app.inject(`/api/books?${new URLSearchParams(params)}`);
      assert.equal(res.statusCode, 200, res.body);
      return res.json() as Array<{ id: number; authors: string }>;
    };
    const ids = (rows: Array<{ id: number }>) => rows.map((b) => b.id).sort((a, b) => a - b);
    for (const author of ['James Tynion IV', 'Джеймс Тайнион IV']) assert.deepEqual(ids(await get({ author })), [10, 17]);
    for (const author of ['Sean Gordon Murphy', 'Шон Мерфи']) assert.deepEqual(ids(await get({ author })), [12, 18]);
    assert.deepEqual(ids(await get({ author: 'Ольга Громыко' })), [2, 23]);
    assert.deepEqual(ids(await get({ author: 'Alvaro Martinez Bueno' })), [17]);
    for (const q of ['James Tynion IV', 'Джеймс Тайнион IV', 'tynion', 'James Tyni', 'Тайни']) assert.deepEqual(ids(await get({ q })), [10, 17]);
    assert.deepEqual(ids(await get({ q: 'Tynion Lake' })), [17]);
    assert.deepEqual(ids(await get({ q: 'Sean Gordon Murphy' })), [12, 18]);
    assert.deepEqual(ids(await get({ q: 'James Tynion IV', tags: 'на английском' })), [17]);
    assert.deepEqual(ids(await get({ author: 'James Tynion IV', q: 'Lake' })), [17]);
    const stats = (await app.inject('/api/stats')).json();
    assert.deepEqual(stats.authors.find((a: { value: string }) => a.value === 'Джеймс Тайнион IV'), { value: 'Джеймс Тайнион IV', count: 2 });
    assert.deepEqual(stats.authors.find((a: { value: string }) => a.value === 'Ольга Громыко'), { value: 'Ольга Громыко', count: 2 });
    assert(!stats.authors.some((a: { value: string }) => a.value.includes(',')));
    // Fixture retains an old, noncanonical cached answer; no network calls needed.
    const cached = sqlite.prepare('SELECT isbn,payload FROM lookup_cache WHERE isbn=(SELECT isbn FROM books WHERE id=17)').get() as { isbn: string; payload: string };
    const data = JSON.parse(cached.payload);
    sqlite.prepare('UPDATE lookup_cache SET payload=? WHERE isbn=?').run(JSON.stringify({ ...data, authors: 'James Tynion IV, Alvaro Martinez Bueno' }), cached.isbn);
    const lookup = await app.inject(`/api/lookup/${cached.isbn}`);
    assert.equal(lookup.json().authors, 'Джеймс Тайнион IV, Álvaro Martínez Bueno');
    let res = await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Alias test', authors: 'James Tynion IV, Джеймс Тайнион IV, Neil Gaiman' } });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().authors, 'Джеймс Тайнион IV, Neil Gaiman');
    const id = res.json().id;
    assert(ids(await get({ q: 'James Tynion IV' })).includes(id));
    res = await app.inject({ method: 'PATCH', url: `/api/books/${id}`, payload: { authors: 'Sean Gordon Murphy, Terry Pratchett' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().authors, 'Шон Мерфи, Terry Pratchett');
    assert(!ids(await get({ q: 'James Tynion IV' })).includes(id));
    assert(ids(await get({ author: 'Sean Murphy' })).includes(id));
    assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    await app.close();
    sqlite.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

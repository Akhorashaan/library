import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';

test('external reading survives migration, supports edits and stays out of the library', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'kartoteka-reading-'));
  assert(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  process.env.DB_PATH = join(temp, 'test.db');
  const { sqlite, initSchema } = await import('../server/db/index.js');
  const { registerRoutes } = await import('../server/routes.js');
  const app = Fastify();
  try {
    // Upgrade the previously deployed journal, including entries without ISBN.
    sqlite.exec(`CREATE TABLE external_reading (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '', finished_at TEXT,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    ); INSERT INTO external_reading (title, authors, finished_at, note, created_at)
      VALUES ('Старая запись', 'Автор', '2000-01-01', 'Сохранить заметку', '2000-01-02');`);
    const legacy = sqlite.prepare('SELECT * FROM external_reading').get();
    initSchema();
    assert.deepEqual(sqlite.prepare('SELECT * FROM external_reading').get(), { ...legacy, isbn: null });
    initSchema();
    assert.deepEqual(sqlite.prepare('SELECT * FROM external_reading').get(), { ...legacy, isbn: null });
    sqlite.prepare('DELETE FROM external_reading').run();
    await registerRoutes(app);
    const library = await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'На полке', status: 'read' } });
    assert.equal(library.statusCode, 201);
    const before = (await app.inject('/api/stats')).json();
    const year = new Date().getFullYear();
    const payload = { title: '  Вне библиотеки  ', authors: 'Автор', finishedAt: `${year}-01-15`, note: 'Читал электронную версию' };
    const created = await app.inject({ method: 'POST', url: '/api/reading/external', payload });
    assert.equal(created.statusCode, 201, created.body);
    const entry = created.json();
    assert.equal(entry.title, 'Вне библиотеки');
    const catalog = (await app.inject('/api/books')).json();
    assert.equal(catalog.length, 1);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM copies').get().n, 1);
    assert.equal((await app.inject('/api/stats')).json().readThisYear, before.readThisYear + 1);
    assert.equal((await app.inject('/api/stats')).json().total, before.total);
    initSchema();
    assert.deepEqual((await app.inject('/api/queue')).json().externalDone, [entry]);
    assert.equal((await app.inject('/api/queue')).json().done[0].id, library.json().id);

    const isbn = '9785389074354';
    const metadata = { isbn, found: true, title: 'Найденная книга', authors: 'Автор', publisher: null,
      year: null, pages: null, binding: null, genre: null, annotation: null, coverUrl: null, sources: {}, tookMs: 0 };
    sqlite.prepare('INSERT INTO lookup_cache (isbn, payload, fetched_at) VALUES (?, ?, ?)').run(isbn, JSON.stringify(metadata), new Date().toISOString());
    const found = await app.inject(`/api/lookup/${isbn}`);
    assert.equal(found.statusCode, 200);
    assert.equal(found.json().title, metadata.title);
    assert.equal(found.json().alreadyInLibrary, null);
    const byIsbn = await app.inject({ method: 'PUT', url: `/api/reading/external/${entry.id}`, payload: { ...payload, title: found.json().title, authors: found.json().authors, isbn: '978-5-389-07435-4' } });
    assert.equal(byIsbn.statusCode, 200, byIsbn.body);
    assert.equal(byIsbn.json().isbn, isbn);
    initSchema();
    assert.equal((await app.inject('/api/queue')).json().externalDone[0].isbn, isbn);
    assert.equal((await app.inject('/api/books')).json().length, 1);
    const invalidIsbn = await app.inject({ method: 'POST', url: '/api/reading/external', payload: { ...payload, isbn: '123' } });
    assert.equal(invalidIsbn.statusCode, 400);
    const cleared = await app.inject({ method: 'PUT', url: `/api/reading/external/${entry.id}`, payload: { ...payload, isbn: '' } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().isbn, null);
    const isbn10 = await app.inject({ method: 'PUT', url: `/api/reading/external/${entry.id}`, payload: { ...payload, isbn: '0-8044-2957-x' } });
    assert.equal(isbn10.statusCode, 200);
    assert.equal(isbn10.json().isbn, '080442957X');
    sqlite.prepare('UPDATE lookup_cache SET payload = ? WHERE isbn = ?').run(JSON.stringify({ ...metadata, found: false, title: null, authors: null }), isbn);
    assert.equal((await app.inject(`/api/lookup/${isbn}`)).json().found, false);

    for (const patch of [{ title: '   ' }, { finishedAt: '2025-02-29' }, { finishedAt: 'yesterday' }, { note: 'x'.repeat(10001) }]) {
      const invalid = await app.inject({ method: 'POST', url: '/api/reading/external', payload: { ...payload, ...patch } });
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
    const edited = await app.inject({ method: 'PUT', url: `/api/reading/external/${entry.id}`, payload: { ...payload, title: 'Исправлено', finishedAt: '2001-02-03', note: 'Новая заметка' } });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().note, 'Новая заметка');
    assert.equal((await app.inject('/api/stats')).json().readThisYear, before.readThisYear);
    const undated = await app.inject({ method: 'PUT', url: `/api/reading/external/${entry.id}`, payload: { ...payload, finishedAt: null } });
    assert.equal(undated.statusCode, 200);
    assert.equal(undated.json().finishedAt, null);
    assert.equal((await app.inject('/api/stats')).json().readThisYear, before.readThisYear);
    for (let i = 0; i < 13; i++) {
      await app.inject({ method: 'POST', url: '/api/books', payload: { title: `Книга ${i}`, status: 'read' } });
    }
    assert.equal((await app.inject('/api/queue')).json().done.length, 14);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/reading/external/${entry.id}` })).statusCode, 200);
    assert.equal((await app.inject('/api/queue')).json().externalDone.length, 0);
    for (const method of ['PUT', 'DELETE'] as const) {
      assert.equal((await app.inject({ method, url: `/api/reading/external/${entry.id}`, ...(method === 'PUT' ? { payload } : {}) })).statusCode, 404);
      assert.equal((await app.inject({ method, url: '/api/reading/external/invalid', ...(method === 'PUT' ? { payload } : {}) })).statusCode, 400);
    }
    assert.equal((await app.inject('/api/books')).json().length, 14);
  } finally {
    await app.close();
    sqlite.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

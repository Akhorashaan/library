import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import Fastify from 'fastify';

test('existing library migration, series order, combined filters and tag editing', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'kartoteka-organization-'));
  process.env.DB_PATH = join(temp, 'test.db');
  const original = new Database('data/backups/before-organization-20260926.db', { readonly: true });
  await original.backup(process.env.DB_PATH);
  original.close();
  const { sqlite, initSchema } = await import('../server/db/index.js');
  const { registerRoutes } = await import('../server/routes.js');
  const app = Fastify();
  try {
    const before = sqlite.prepare('SELECT * FROM books ORDER BY id').all() as Record<string, unknown>[];
    initSchema();
    initSchema();
    const migrated = sqlite.prepare('SELECT * FROM books ORDER BY id').all() as Record<string, unknown>[];
    for (let i = 0; i < before.length; i++) for (const key of Object.keys(before[i]!)) assert.deepEqual(migrated[i]![key], before[i]![key]);
    assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    await registerRoutes(app);
    const plan = JSON.parse(readFileSync('data/organization-20260926.json', 'utf8'));
    for (const { id, isbn, ...patch } of plan) {
      const res = await app.inject({ method: 'PATCH', url: `/api/books/${id}`, payload: patch });
      assert.equal(res.statusCode, 200, res.body);
    }
    const get = async (params: Record<string, string> = {}) => {
      const res = await app.inject(`/api/books?${new URLSearchParams(params)}`);
      assert.equal(res.statusCode, 200, res.body);
      return res.json() as Array<{ id: number; tags: string[]; seriesOrder: number; seriesEnd: number; series: string }>;
    };
    assert.deepEqual((await get({ series: 'Американский вампир', sort: 'series' })).map((b) => b.id), [11, 7, 8, 9]);
    assert.deepEqual((await get({ series: 'Сага о живых кораблях', sort: 'series', q: 'кораб' })).map((b) => b.id), [28, 30, 29]);
    assert.deepEqual((await get({ series: 'Хроники Дождевых чащоб' })).map((b) => b.id), [27, 32, 38, 31]);
    const farseer = await get({ series: 'Сага о Видящих' });
    assert.deepEqual(farseer.map((b) => b.id), [34, 33]);
    assert.equal(farseer[0]!.seriesEnd, 2);
    const andFilter = await app.inject(`/api/books?${new URLSearchParams([['tags', 'комиксы'], ['tags', 'вампиры']])}`);
    assert.equal(andFilter.statusCode, 200);
    assert.equal(andFilter.json().length, 5);
    assert.equal((await get({ q: 'элдерлингов' })).length, 15);
    assert.equal((await get({ tags: 'фэнтези', series: 'Гарри Поттер', yearFrom: '2017', yearTo: '2017' })).length, 1);
    assert.equal((await get({ missing: 'tags' })).length, 0);
    assert.equal((await get({ lent: 'false' })).length, 48);
    for (const payload of [{ seriesOrder: -1 }, { seriesOrder: 4, seriesEnd: 2 }, { tags: [''] }, { tags: 'not-an-array' }]) {
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/books/1', payload })).statusCode, 400);
    }
    assert.equal((await app.inject('/api/books?yearFrom=2025&yearTo=2000')).statusCode, 400);
    let res = await app.inject({ method: 'PATCH', url: '/api/books/1', payload: { tags: [' ТЕСТ ', 'тест', 'Новый   Тег'], series: null } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().tags, ['тест', 'новый тег']);
    assert.equal(res.json().seriesOrder, null);
    assert.equal(res.json().seriesEnd, null);
    assert.equal((await get({ q: 'новый тег' })).length, 1);
    res = await app.inject({ method: 'PATCH', url: '/api/books/1', payload: { tags: [] } });
    assert.equal(res.statusCode, 200);
    assert.equal((await get({ q: 'новый тег' })).length, 0);
    const stats = (await app.inject('/api/stats')).json();
    assert(!stats.tags.some((t: { value: string }) => t.value === 'тест'));
    res = await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Temporary', series: 'Temporary series', seriesOrder: 10, tags: ['temporary'] } });
    assert.equal(res.statusCode, 201, res.body);
    const id = res.json().id;
    assert.equal((await get({ q: 'temporary' })).length, 1);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/books/${id}` })).statusCode, 200);
    assert.equal((await get({ q: 'temporary' })).length, 0);
    assert.equal((sqlite.prepare('SELECT count(*) n FROM books_fts').get() as { n: number }).n, 48);
  } finally {
    await app.close();
    sqlite.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

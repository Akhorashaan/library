import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqlite } from '../server/db/index.js';
import { shelfmark, sortKey } from '../server/metadata/normalize.js';

// Curated, ISBN-specific data import. Dry run by default; never runs on startup.
type Value = string | number | string[] | null;
type Entry = {
  isbn: string;
  action: 'update' | 'insert';
  expected?: Record<string, Value>;
  fields: Record<string, Value>;
  sources: string[];
  coverSource?: string;
  note?: string;
};
const entries: Entry[] = JSON.parse(readFileSync('data/enrichment-20260926.json', 'utf8'));
const apply = process.argv.includes('--apply');
const allowed = new Set(['title', 'authors', 'publisher', 'year', 'pages', 'binding', 'genre', 'series', 'series_order', 'tags', 'annotation', 'cover_url']);
const encode = (v: Value) => Array.isArray(v) ? JSON.stringify(v) : v;
const camel = (k: string) => ({ cover_url: 'coverUrl', series_order: 'seriesOrder' }[k] ?? k);
const getBook = sqlite.prepare('SELECT * FROM books WHERE isbn=?');
const getUnresolved = sqlite.prepare('SELECT * FROM unresolved WHERE isbn=?');
function validate(entry: Entry) {
  const current = getBook.get(entry.isbn) as Record<string, Value> | undefined;
  for (const [key, value] of Object.entries(entry.fields)) {
    if (!allowed.has(key)) throw new Error(`Unexpected field: ${key}`);
    if (key === 'cover_url' && (typeof value !== 'string' || !/^\/covers\/[\w.-]+$/.test(value) || !existsSync(resolve('data', value.slice(1))))) {
      throw new Error(`Missing cover: ${entry.isbn}`);
    }
  }
  if (current && Object.entries(entry.fields).every(([k, v]) => current[k] === encode(v))) return 'skip';
  if (entry.action === 'insert') {
    if (current || !getUnresolved.get(entry.isbn)) throw new Error(`Insert state changed: ${entry.isbn}`);
    if (!entry.fields.title || !entry.fields.authors) throw new Error(`Incomplete book: ${entry.isbn}`);
  } else {
    if (!current || !entry.expected || Object.entries(entry.expected).some(([k, v]) => current[k] !== encode(v))) {
      throw new Error(`Book changed since research: ${entry.isbn}`);
    }
  }
  return entry.action;
}
const preview = entries.map((entry) => ({ isbn: entry.isbn, action: validate(entry), fields: Object.keys(entry.fields) }));
let backup: string | undefined;
if (apply && preview.some((row) => row.action !== 'skip')) {
  mkdirSync('data/backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backup = `data/backups/before-enrichment-${stamp}.db`;
  await sqlite.backup(backup);
  sqlite.transaction(() => {
    for (const entry of entries) {
      const action = validate(entry);
      if (action === 'skip') continue;
      const before = getBook.get(entry.isbn) as Record<string, Value> | undefined;
      const provenance = JSON.parse(String(before?.source ?? '{}'));
      for (const key of Object.keys(entry.fields)) {
        provenance[camel(key)] = ['series', 'series_order', 'tags'].includes(key)
          ? 'manual' : new URL(key === 'cover_url' ? entry.coverSource! : entry.sources[0]!).hostname;
      }
      const title = String(entry.fields.title ?? before?.title);
      const authors = String(entry.fields.authors ?? before?.authors);
      const values: Record<string, Value> = {
        ...entry.fields, source: JSON.stringify(provenance),
        shelfmark: shelfmark(authors, title), sort_key: sortKey(authors, title),
      };
      if (action === 'insert') {
        const pending = getUnresolved.get(entry.isbn) as { first_seen: string; note: string | null };
        values.isbn = entry.isbn;
        values.created_at = pending.first_seen;
        const keys = Object.keys(values);
        const inserted = sqlite.prepare(`INSERT INTO books (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values).map(encode));
        sqlite.prepare('INSERT INTO copies (book_id) VALUES (?)').run(inserted.lastInsertRowid);
        sqlite.prepare('INSERT INTO reading (book_id,status,note) VALUES (?, ?, ?)').run(inserted.lastInsertRowid, 'none', pending.note);
        sqlite.prepare('DELETE FROM unresolved WHERE isbn=?').run(entry.isbn);
      } else {
        sqlite.prepare(`UPDATE books SET ${Object.keys(values).map((key) => `${key}=?`).join(',')} WHERE isbn=?`).run(...Object.values(values).map(encode), entry.isbn);
      }
      const after = getBook.get(entry.isbn) as Record<string, Value>;
      const payload: Record<string, unknown> = { isbn: entry.isbn, found: true, sources: provenance, tookMs: 0 };
      for (const key of allowed) payload[camel(key)] = key === 'tags' ? JSON.parse(String(after[key])) : after[key];
      sqlite.prepare('INSERT INTO lookup_cache (isbn,payload,fetched_at) VALUES (?,?,?) ON CONFLICT(isbn) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at')
        .run(entry.isbn, JSON.stringify(payload), new Date().toISOString());
    }
    if (sqlite.pragma('foreign_key_check').length) throw new Error('Foreign key check failed');
    if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Integrity check failed');
  })();
  writeFileSync(`data/backups/enrichment-${stamp}.json`, JSON.stringify({ backup, preview, entries }, null, 2));
}
console.log(JSON.stringify({ dryRun: !apply, backup, updated: preview.filter((r) => r.action === 'update').length, inserted: preview.filter((r) => r.action === 'insert').length, skipped: preview.filter((r) => r.action === 'skip').length }, null, 2));
sqlite.close();

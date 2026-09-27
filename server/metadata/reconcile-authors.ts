import type Database from 'better-sqlite3';
import { normalizeAuthors } from '../../shared/authors.js';
import { shelfmark, sortKey } from './normalize.js';

/** Explicit maintenance operation, not a startup migration. Caller backs up before applying. */
export function reconcileAuthors(sqlite: Database.Database, apply = false) {
  const books = (sqlite.prepare('SELECT id,authors,title,sort_key,shelfmark FROM books').all() as Array<{
    id: number; authors: string; title: string; sort_key: string; shelfmark: string;
  }>).flatMap((before) => {
    const authors = normalizeAuthors(before.authors);
    const after = { authors, sort_key: sortKey(authors, before.title), shelfmark: shelfmark(authors, before.title) };
    return authors === before.authors && after.sort_key === before.sort_key && after.shelfmark === before.shelfmark ? [] : [{ before, after }];
  });
  const cache = (sqlite.prepare('SELECT isbn,payload FROM lookup_cache').all() as Array<{ isbn: string; payload: string }>).flatMap((row) => {
    const data = JSON.parse(row.payload);
    const authors = normalizeAuthors(data.authors) || null;
    return authors === data.authors ? [] : [{ ...row, after: JSON.stringify({ ...data, authors }) }];
  });
  if (apply) sqlite.transaction(() => {
    for (const { before, after } of books) {
      const result = sqlite.prepare('UPDATE books SET authors=?,sort_key=?,shelfmark=? WHERE id=? AND authors=? AND title=? AND sort_key=? AND shelfmark=?')
        .run(after.authors, after.sort_key, after.shelfmark, before.id, before.authors, before.title, before.sort_key, before.shelfmark);
      if (result.changes !== 1) throw new Error(`Book changed during author reconciliation: ${before.id}`);
    }
    for (const row of cache) {
      const result = sqlite.prepare('UPDATE lookup_cache SET payload=? WHERE isbn=? AND payload=?').run(row.after, row.isbn, row.payload);
      if (result.changes !== 1) throw new Error(`Cache changed during author reconciliation: ${row.isbn}`);
    }
  })();
  return { books, cache };
}

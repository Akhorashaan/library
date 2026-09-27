import { mkdirSync, writeFileSync } from 'node:fs';
import { sqlite } from '../server/db/index.js';
import { reconcileAuthors } from '../server/metadata/reconcile-authors.js';

const apply = process.argv.includes('--apply');
let result = reconcileAuthors(sqlite);
let backup: string | undefined;
if (apply && (result.books.length || result.cache.length)) {
  mkdirSync('data/backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backup = `data/backups/before-author-reconciliation-${stamp}.db`;
  await sqlite.backup(backup);
  result = reconcileAuthors(sqlite, true);
  writeFileSync(`data/backups/author-reconciliation-${stamp}.json`, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ dryRun: !apply, backup, books: result.books, cacheUpdated: result.cache.length }, null, 2));
sqlite.close();

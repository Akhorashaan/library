import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { sqlite, initSchema } from '../server/db/index.js';
import { bookPatch } from '../shared/schema.js';

// Explicit one-time import; never runs on server startup or replaces later manual edits.
initSchema();
const plan = JSON.parse(readFileSync('data/organization-20260926.json', 'utf8')) as Array<Record<string, unknown>>;
const dryRun = !process.argv.includes('--apply');
const changes = plan.map((entry) => {
  const current = sqlite.prepare('SELECT id,isbn,series,tags FROM books WHERE id=?').get(entry.id) as { isbn: string; series: string | null; tags: string } | undefined;
  if (!current || current.isbn !== entry.isbn) throw new Error(`ISBN mismatch for book ${entry.id}`);
  const patch = bookPatch.parse(entry);
  return { id: entry.id, series: patch.series ?? null, start: patch.seriesOrder ?? null, end: patch.seriesEnd ?? null, tags: patch.tags ?? [], skip: current.series !== null || current.tags !== '[]' };
});
if (!dryRun) {
  mkdirSync('data/backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await sqlite.backup(`data/backups/before-classification-${stamp}.db`);
  sqlite.transaction(() => {
    const update = sqlite.prepare("UPDATE books SET series=?, series_order=?, series_end=?, tags=? WHERE id=? AND series IS NULL AND tags='[]'");
    for (const row of changes) if (!row.skip) update.run(row.series, row.start, row.end, JSON.stringify(row.tags), row.id);
  })();
  writeFileSync(`data/backups/classification-${stamp}.json`, JSON.stringify(changes, null, 2));
}
console.log(JSON.stringify({ dryRun, classified: changes.filter((r) => !r.skip).length, skipped: changes.filter((r) => r.skip).length, series: new Set(changes.map((r) => r.series).filter(Boolean)).size, tags: new Set(changes.flatMap((r) => r.tags)).size }));
sqlite.close();

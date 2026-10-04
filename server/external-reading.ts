import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { externalReading } from './db/schema.js';
import { externalReadingInput } from '../shared/external-reading.js';
import { normalizeAuthors } from '../shared/authors.js';

export function listExternalReading() {
  return db.select().from(externalReading).orderBy(desc(externalReading.finishedAt), desc(externalReading.id)).all();
}

export async function registerExternalReadingRoutes(app: FastifyInstance) {
  app.post('/api/reading/external', async (req, reply) => {
    const parsed = externalReadingInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const entry = db.insert(externalReading).values({
      ...parsed.data,
      authors: normalizeAuthors(parsed.data.authors),
      createdAt: new Date().toISOString(),
    }).returning().get();
    return reply.code(201).send(entry);
  });

  app.put<{ Params: { id: string } }>('/api/reading/external/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'Некорректный номер записи' });
    const parsed = externalReadingInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const entry = db.update(externalReading).set({ ...parsed.data, authors: normalizeAuthors(parsed.data.authors) })
      .where(eq(externalReading.id, id)).returning().get();
    return entry ?? reply.code(404).send({ error: 'Запись не найдена' });
  });

  app.delete<{ Params: { id: string } }>('/api/reading/external/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'Некорректный номер записи' });
    const deleted = db.delete(externalReading).where(eq(externalReading.id, id)).returning().get();
    return deleted ? { ok: true } : reply.code(404).send({ error: 'Запись не найдена' });
  });
}

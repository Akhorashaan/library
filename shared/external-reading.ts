import { z } from 'zod';
import { isbnSchema } from './schema.js';

/** A reading journal entry for a book that is not in the home library. */
export const externalReadingInput = z.object({
  isbn: z.preprocess(value => typeof value === 'string' && !value.trim() ? null : value, isbnSchema.nullable().optional()),
  title: z.string().trim().min(1, 'Укажите название книги').max(500),
  authors: z.string().trim().max(500).default(''),
  coverUrl: z.union([z.url({ protocol: /^https?$/ }), z.string().regex(/^\/covers\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/)]).nullable().optional(),
  finishedAt: z.iso.date().nullable(),
  note: z.string().trim().max(10000).default(''),
});

export type ExternalReadingInput = z.infer<typeof externalReadingInput>;
export type ExternalReading = ExternalReadingInput & { id: number; createdAt: string };

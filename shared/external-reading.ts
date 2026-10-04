import { z } from 'zod';

/** A reading journal entry for a book that is not in the home library. */
export const externalReadingInput = z.object({
  title: z.string().trim().min(1, 'Укажите название книги').max(500),
  authors: z.string().trim().max(500).default(''),
  finishedAt: z.iso.date().nullable(),
  note: z.string().trim().max(10000).default(''),
});

export type ExternalReadingInput = z.infer<typeof externalReadingInput>;
export type ExternalReading = ExternalReadingInput & { id: number; createdAt: string };

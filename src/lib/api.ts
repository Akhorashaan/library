import type { BookInput, BookPatch, BookQuery, LookupResult, ReadingStatus, Stats, Unresolved } from '@shared/schema';
import type { SeriesEntry, SeriesPreference, SeriesReference } from '@shared/series';
import type { ExternalReading, ExternalReadingInput } from '@shared/external-reading';

export type Book = {
  id: number;
  isbn: string | null;
  title: string;
  authors: string;
  publisher: string | null;
  year: number | null;
  pages: number | null;
  binding: string | null;
  genre: string | null;
  series: string | null;
  seriesOrder: number | null;
  seriesEnd: number | null;
  seriesPart: number | null;
  tags: string[];
  annotation: string | null;
  coverUrl: string | null;
  source: string | null;
  shelfmark: string;
  createdAt: string;
  condition: string | null;
  lentTo: string | null;
  lentAt: string | null;
  status: ReadingStatus;
  progress: number | null;
  note: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  queuePos: number | null;
};

/** Набор фильтров каталога — то, что человек выбрал в панели. */
export type Filters = Partial<Pick<BookQuery, 'status' | 'genre' | 'author' | 'publisher' | 'lent' | 'sort' | 'series' | 'tags' | 'missing' | 'yearFrom' | 'yearTo'>>;

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Сообщение сервера человеку понятнее, чем «Request failed with 409».
    const message =
      (body as any)?.error && typeof (body as any).error === 'string'
        ? (body as any).error
        : `Запрос не прошёл (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  series: () => call<SeriesEntry[]>('/series'),
  followSeries: (input: SeriesPreference) => call<SeriesPreference>('/series/preference', { method: 'PUT', body: JSON.stringify(input) }),
  saveSeries: (input: SeriesReference) => call<SeriesReference>('/series/reference', { method: 'PUT', body: JSON.stringify(input) }),
  books: (params: Filters & { q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.q?.trim()) sp.set('q', params.q.trim());
    if (params.status) sp.set('status', params.status);
    if (params.genre) sp.set('genre', params.genre);
    if (params.author) sp.set('author', params.author);
    if (params.publisher) sp.set('publisher', params.publisher);
    if (params.series) sp.set('series', params.series);
    for (const tag of params.tags ?? []) sp.append('tags', tag);
    if (params.missing) sp.set('missing', params.missing);
    if (params.yearFrom !== undefined) sp.set('yearFrom', String(params.yearFrom));
    if (params.yearTo !== undefined) sp.set('yearTo', String(params.yearTo));
    if (params.lent) sp.set('lent', 'true');
    if (params.sort) sp.set('sort', params.sort);
    const qs = sp.toString();
    return call<Book[]>(`/books${qs ? `?${qs}` : ''}`);
  },

  book: (id: number) => call<Book>(`/books/${id}`),

  create: (input: BookInput) => call<Book>('/books', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: number, patch: BookPatch) =>
    call<Book>(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  remove: (id: number) => call<{ ok: true }>(`/books/${id}`, { method: 'DELETE' }),

  lookup: (isbn: string, fresh = false, signal?: AbortSignal) =>
    call<LookupResult>(`/lookup/${isbn}${fresh ? '?fresh=1' : ''}`, { signal }),

  queue: () => call<{ now: Book[]; queue: Book[]; done: Book[]; externalDone: ExternalReading[] }>('/queue'),

  createExternalReading: (input: ExternalReadingInput) =>
    call<ExternalReading>('/reading/external', { method: 'POST', body: JSON.stringify(input) }),
  updateExternalReading: (id: number, input: ExternalReadingInput) =>
    call<ExternalReading>(`/reading/external/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeExternalReading: (id: number) =>
    call<{ ok: true }>(`/reading/external/${id}`, { method: 'DELETE' }),

  reorder: (ids: number[]) =>
    call<{ ok: true }>('/queue/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),

  stats: () => call<Stats>('/stats'),

  /* Стопка «на разбор»: ISBN, которых не знает ни один источник. */
  unresolved: () => call<Unresolved[]>('/unresolved'),

  defer: (isbn: string, note?: string) =>
    call<Unresolved>('/unresolved', { method: 'POST', body: JSON.stringify({ isbn, note }) }),

  noteUnresolved: (isbn: string, note: string | null) =>
    call<Unresolved>(`/unresolved/${isbn}`, { method: 'PATCH', body: JSON.stringify({ note }) }),

  dropUnresolved: (isbn: string) =>
    call<{ ok: true }>(`/unresolved/${isbn}`, { method: 'DELETE' }),
};

export { ApiError };

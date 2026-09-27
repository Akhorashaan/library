import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { lookupCache } from '../db/schema.js';
import { SOURCES, type SourceData, type SourceName } from './sources.js';
import { hasCyrillic, isTranslit, normalizeAuthor, normalizePublisher, tidy, trimAnnotation } from './normalize.js';

export type Lookup = {
  isbn: string;
  found: boolean;
  title: string | null;
  authors: string | null;
  publisher: string | null;
  year: number | null;
  pages: number | null;
  binding: string | null;
  genre: string | null;
  annotation: string | null;
  coverUrl: string | null;
  /** Какое поле откуда приехало — показываем в интерфейсе, это чинит доверие. */
  sources: Record<string, string>;
  tookMs: number;
};

type Harvest = Partial<Record<SourceName, SourceData>>;

/**
 * Порядок доверия — свой для каждого слоя.
 *
 * Произведение (название, автор, аннотация, жанр) лучше всего знает LiveLib:
 * он единственный стабильно отдаёт кириллицу. Но он группирует все издания
 * в одну карточку, поэтому год и число страниц у него относятся неизвестно
 * к какому томику — их берём там, где ответ привязан к запрошенному ISBN.
 */
const ORDER = {
  title: ['livelib', 'k10plus', 'google', 'openlibrary', 'loc'],
  authors: ['livelib', 'k10plus', 'google', 'openlibrary', 'loc'],
  publisher: ['livelib', 'google', 'k10plus', 'openlibrary', 'loc'],
  genre: ['livelib', 'google'],
  annotation: ['livelib', 'google'],
  binding: ['livelib'],
  year: ['google', 'openlibrary', 'loc', 'k10plus', 'livelib'],
  pages: ['google', 'openlibrary', 'loc'],
  coverUrl: ['livelib', 'google', 'openlibrary'],
} satisfies Record<string, SourceName[]>;

/** Первое непустое значение по порядку доверия; запоминает, кто его дал. */
function pick<K extends keyof SourceData>(
  harvest: Harvest,
  field: K,
  order: readonly SourceName[],
  credits: Record<string, string>,
  accept: (v: NonNullable<SourceData[K]>) => boolean = () => true
): SourceData[K] | undefined {
  for (const name of order) {
    const v = harvest[name]?.[field];
    if (v === undefined || v === null || v === '') continue;
    if (!accept(v as NonNullable<SourceData[K]>)) continue;
    credits[field as string] = name;
    return v;
  }
  return undefined;
}

/**
 * Текстовое поле в три захода: сперва ищем кириллицу, затем просто нелатинскую
 * транслитерацию, и лишь потом соглашаемся на что угодно. Так «Любовь к трем
 * цукербринам» побеждает «Li︠u︡bovʹ k trem t︠s︡ukerbrinam», даже если последнее
 * пришло от более приоритетного источника.
 */
function pickText(
  harvest: Harvest,
  field: 'title' | 'authors' | 'publisher',
  order: readonly SourceName[],
  credits: Record<string, string>
): string | undefined {
  return (
    pick(harvest, field, order, credits, hasCyrillic) ??
    pick(harvest, field, order, credits, (v) => !isTranslit(v)) ??
    pick(harvest, field, order, credits)
  );
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Опрашивает все источники разом и собирает из ответов одну запись.
 * Медленный или упавший источник не задерживает остальных — ждём всех,
 * но каждого не дольше своего срока.
 */
export async function lookupIsbn(isbn: string, opts: { noCache?: boolean } = {}): Promise<Lookup> {
  const started = Date.now();

  if (!opts.noCache) {
    const hit = db.select().from(lookupCache).where(eq(lookupCache.isbn, isbn)).get();
    if (hit) {
      const cached = JSON.parse(hit.payload) as Lookup;
      return { ...cached, authors: normalizeAuthor(cached.authors) ?? null, tookMs: 0 };
    }
  }

  const names = Object.keys(SOURCES) as SourceName[];
  const settled = await Promise.allSettled(
    names.map((n) => withTimeout(SOURCES[n](isbn), n === 'livelib' ? 22000 : 16000))
  );

  const harvest: Harvest = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) harvest[names[i]!] = r.value;
  });

  const credits: Record<string, string> = {};
  const title = tidy(pickText(harvest, 'title', ORDER.title, credits));
  const authors = normalizeAuthor(pickText(harvest, 'authors', ORDER.authors, credits));
  const publisher = normalizePublisher(pickText(harvest, 'publisher', ORDER.publisher, credits));

  const result: Lookup = {
    isbn,
    found: Boolean(title),
    title: title ?? null,
    authors: authors ?? null,
    publisher: publisher ?? null,
    year: pick(harvest, 'year', ORDER.year, credits) ?? null,
    pages: pick(harvest, 'pages', ORDER.pages, credits) ?? null,
    binding: tidy(pick(harvest, 'binding', ORDER.binding, credits)) ?? null,
    genre: tidy(pick(harvest, 'genre', ORDER.genre, credits)) ?? null,
    annotation: trimAnnotation(pick(harvest, 'annotation', ORDER.annotation, credits)) ?? null,
    coverUrl: pick(harvest, 'coverUrl', ORDER.coverUrl, credits) ?? null,
    sources: credits,
    tookMs: Date.now() - started,
  };

  // Кэшируем и промахи: если книги нет ни в одном источнике, второй скан
  // того же штрих-кода не должен снова ждать пять сетевых запросов.
  db.insert(lookupCache)
    .values({ isbn, payload: JSON.stringify(result), fetchedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: lookupCache.isbn,
      set: { payload: JSON.stringify(result), fetchedAt: new Date().toISOString() },
    })
    .run();

  return result;
}

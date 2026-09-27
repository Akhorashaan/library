/**
 * Источники метаданных по ISBN.
 *
 * Каждый возвращает частичную запись — чего не знает, того не выдумывает.
 * Сборкой занимается index.ts, потому что «кто прав» зависит от поля:
 * названия лучше у одних, год издания у других.
 */

import { bibliographicAuthor } from '../../shared/authors.js';

const UA = 'kartoteka/0.1 (home library catalogue)';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export type SourceData = {
  title?: string;
  authors?: string;
  publisher?: string;
  year?: number;
  pages?: number;
  binding?: string;
  genre?: string;
  annotation?: string;
  coverUrl?: string;
};

export type SourceName = 'livelib' | 'k10plus' | 'google' | 'openlibrary' | 'loc';

async function text(url: string, ms: number, ua = UA): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function json(url: string, ms: number): Promise<any> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const year = (v: unknown): number | undefined => {
  const m = String(v ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
};

/* ────────────────────────────────── LiveLib ────────────────────────────────
   Не API, а разбор schema.org-разметки публичной страницы. Держится на JSON-LD,
   а не на CSS-селекторах: разметка живёт ради поисковой выдачи и переживает
   редизайны. Стоит два запроса — поиск, затем карточка.

   Осторожно: LiveLib группирует издания в одно произведение и кладёт в разметку
   данные какого-то одного из них. Название, автор и аннотация верны, а год
   и издательство могут относиться к другому изданию — index.ts берёт их у других.
   ──────────────────────────────────────────────────────────────────────────── */
export async function livelib(isbn: string): Promise<SourceData | null> {
  const search = await text(`https://www.livelib.ru/find/${isbn}`, 20000, BROWSER_UA);
  const href = search.match(/href="(\/book\/\d+-[^"]+)"/)?.[1];
  if (!href) return null;

  const card = await text(`https://www.livelib.ru${href}`, 20000, BROWSER_UA);
  const raw = card.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return null;

  const parsed = JSON.parse(raw);
  const nodes: any[] = parsed['@graph'] ?? [parsed];
  const b = nodes.find((n) => n['@type'] === 'Book');
  if (!b) return null;

  const bindingRaw = String(b.bookFormat ?? '').split('/').pop();
  const BINDING: Record<string, string> = {
    Hardcover: 'Твёрдый',
    Paperback: 'Мягкий',
    EBook: 'Электронная',
    AudiobookFormat: 'Аудио',
  };

  return {
    title: b.name || undefined,
    authors: b.author?.name ?? (typeof b.author === 'string' ? b.author : undefined),
    publisher: b.publisher?.name ?? undefined,
    year: year(b.datePublished),
    binding: bindingRaw ? (BINDING[bindingRaw] ?? bindingRaw) : undefined,
    genre: typeof b.genre === 'string' ? b.genre.split(',')[0]?.trim() : undefined,
    annotation: b.description || undefined,
    coverUrl: b.image?.url ?? (typeof b.image === 'string' ? b.image : undefined),
  };
}

/* ───────────────────────────────── K10plus ─────────────────────────────────
   Сводный каталог библиотек Германии, сильная славистика. Помнит издания,
   которых давно нет в продаже, и часто хранит заглавие сразу в двух формах —
   транслитерации и кириллице.
   ──────────────────────────────────────────────────────────────────────────── */
const tags = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))]
    .map((m) => (m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const preferCyrillic = (list: string[]): string | undefined =>
  list.find((s) => /[А-Яа-яЁё]/.test(s)) ?? list[0];

export async function k10plus(isbn: string): Promise<SourceData | null> {
  const xml = await text(
    `https://sru.k10plus.de/gvk?version=1.1&operation=searchRetrieve&query=pica.isb%3D${isbn}&maximumRecords=1&recordSchema=dc`,
    20000
  );
  if (!/<(?:zs:)?numberOfRecords>[1-9]/.test(xml)) return null;

  // «Пелевин, Виктор (VerfasserIn)» — служебная пометка роли, читателю не нужна.
  const author = preferCyrillic(tags(xml, 'creator'))?.replace(/\s*\([^)]*\)\s*$/, '');
  return {
    title: preferCyrillic(tags(xml, 'title')),
    authors: author ? bibliographicAuthor(author) : undefined,
    publisher: preferCyrillic(tags(xml, 'publisher')),
    year: year(tags(xml, 'date')[0]),
  };
}

/* ────────────────────────────── Google Books ───────────────────────────────
   Лучшее покрытие по году и числу страниц. Свой ключ обязателен: без него
   анонимная квота общая на адрес и обычно уже исчерпана кем-то другим.
   ──────────────────────────────────────────────────────────────────────────── */
export async function google(isbn: string): Promise<SourceData | null> {
  const key = process.env.GOOGLE_BOOKS_KEY;
  const j = await json(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}` + (key ? `&key=${key}` : ''),
    15000
  );
  const v = j.items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: v.title ? v.title + (v.subtitle ? `: ${v.subtitle}` : '') : undefined,
    authors: v.authors?.join(', '),
    publisher: v.publisher,
    year: year(v.publishedDate),
    pages: v.pageCount || undefined,
    genre: v.categories?.[0],
    annotation: v.description,
    coverUrl: v.imageLinks?.thumbnail?.replace(/^http:/, 'https:'),
  };
}

/* ──────────────────────────────── OpenLibrary ──────────────────────────────
   Свободный, без ключа и лимитов. Надёжен по числу страниц и году конкретного
   издания. Названия русских книг нередко в транслитерации ALA-LC — отбраковкой
   занимается normalize.ts.
   ──────────────────────────────────────────────────────────────────────────── */
export async function openlibrary(isbn: string): Promise<SourceData | null> {
  const j = await json(`https://openlibrary.org/isbn/${isbn}.json`, 15000);
  if (!j?.title) return null;

  // Автор лежит отдельной сущностью — за именем нужен второй запрос.
  let authors: string | undefined;
  if (Array.isArray(j.authors) && j.authors.length) {
    const names = await Promise.all(
      j.authors.slice(0, 3).map(async (a: any) => {
        try {
          return (await json(`https://openlibrary.org${a.key}.json`, 10000))?.name as string;
        } catch {
          return null;
        }
      })
    );
    authors = names.filter(Boolean).join(', ') || undefined;
  }

  return {
    title: j.title,
    authors,
    publisher: j.publishers?.[0],
    year: year(j.publish_date),
    pages: j.number_of_pages || undefined,
    coverUrl: j.covers?.length ? `https://covers.openlibrary.org/b/id/${j.covers[0]}-L.jpg` : undefined,
  };
}

/* ──────────────────────────── Library of Congress ──────────────────────────
   SRU без ключа и регистрации. Добивка по году и числу страниц.
   ──────────────────────────────────────────────────────────────────────────── */
export async function loc(isbn: string): Promise<SourceData | null> {
  const xml = await text(
    `http://lx2.loc.gov:210/lcdb?operation=searchRetrieve&version=1.1&query=bath.isbn=${isbn}&maximumRecords=1&recordSchema=mods`,
    20000
  );
  const titles = tags(xml, 'title');
  if (!titles.length) return null;
  const extent = tags(xml, 'extent')[0];
  return {
    title: preferCyrillic(titles),
    authors: tags(xml, 'namePart')[0] ? bibliographicAuthor(tags(xml, 'namePart')[0]!.replace(/,\s*$/, '')) : undefined,
    publisher: tags(xml, 'publisher')[0],
    year: year(tags(xml, 'dateIssued')[0]),
    pages: extent ? Number(extent.match(/\d+/)?.[0]) || undefined : undefined,
  };
}

export const SOURCES: Record<SourceName, (isbn: string) => Promise<SourceData | null>> = {
  livelib,
  k10plus,
  google,
  openlibrary,
  loc,
};

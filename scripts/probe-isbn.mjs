#!/usr/bin/env node
/**
 * Пробник источников метаданных по ISBN.
 *
 * Общие рассуждения о покрытии бесполезны — оно зависит от того, что именно
 * стоит у тебя на полках. Возьми 15–20 книг, перепиши ISBN с задней обложки
 * и прогони. Каскад в приложении строим по результату, а не по ожиданиям.
 *
 *   node scripts/probe-isbn.mjs 9785699539628 9785389218215 …
 *   node scripts/probe-isbn.mjs --file my-shelf.txt      (по одному ISBN в строке)
 *
 * Ключ Google Books (бесплатный, из Google Cloud Console) заметно влияет
 * на результат — без него общая анонимная квота обычно уже исчерпана:
 *   GOOGLE_BOOKS_KEY=… node scripts/probe-isbn.mjs …
 */

import { readFile } from 'node:fs/promises';

// Только latin-1: HTTP-заголовки не принимают кириллицу.
const UA = 'kartoteka-probe/0.1 (home library catalogue)';
const KEY = process.env.GOOGLE_BOOKS_KEY;

const clean = (s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase();

/** ISBN-13 с дефисами в том виде, в каком его хранит Wikidata (978-5-…). */
function hyphenateRu(isbn) {
  if (!/^9785\d{9}$/.test(isbn)) return null;
  // Российские издательские префиксы переменной длины; для пробника хватит
  // грубого разбиения — Wikidata всё равно проверяется и без дефисов.
  return `${isbn.slice(0, 3)}-${isbn.slice(3, 4)}-${isbn.slice(4, 8)}-${isbn.slice(8, 12)}-${isbn.slice(12)}`;
}

async function getJson(url, ms = 12000) {
  const ctl = AbortSignal.timeout(ms);
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl });
  if (!res.ok) return { __status: res.status };
  return res.json();
}

// ---------------------------------------------------------------- источники

async function googleBooks(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}` + (KEY ? `&key=${KEY}` : '');
  try {
    const j = await getJson(url);
    if (j.__status === 429) return { status: 'квота', note: KEY ? 'ключ исчерпан' : 'нет ключа' };
    if (j.__status) return { status: 'ошибка', note: `HTTP ${j.__status}` };
    const v = j.items?.[0]?.volumeInfo;
    if (!v) return { status: 'нет' };
    return {
      status: 'да',
      title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''),
      authors: v.authors?.join(', '),
      publisher: v.publisher,
      year: v.publishedDate?.slice(0, 4),
      pages: v.pageCount,
      cover: Boolean(v.imageLinks?.thumbnail),
    };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

async function openLibrary(isbn) {
  try {
    const j = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
    if (j.__status) return { status: 'нет' };
    // Автор лежит отдельной сущностью — за ним нужен второй запрос.
    let authors;
    if (j.authors?.length) {
      const names = await Promise.all(
        j.authors.slice(0, 3).map(async (a) => {
          try {
            const au = await getJson(`https://openlibrary.org${a.key}.json`);
            return au.name;
          } catch { return null; }
        })
      );
      authors = names.filter(Boolean).join(', ');
    }
    return {
      status: 'да',
      title: j.title,
      authors,
      publisher: j.publishers?.[0],
      year: String(j.publish_date ?? '').match(/\d{4}/)?.[0],
      pages: j.number_of_pages,
      cover: Boolean(j.covers?.length),
      translit: isTranslit(j.title),
    };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

/** Обложка может найтись даже там, где библиографической записи нет. */
async function olCover(isbn) {
  try {
    const res = await fetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, {
      headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { status: 'нет' };
    const size = (await res.arrayBuffer()).byteLength;
    // Мелкие файлы — это заглушки в 1–2 пиксельных полоски, не обложки.
    return size > 5000 ? { status: 'да', note: `${Math.round(size / 1024)} КБ` } : { status: 'нет', note: 'заглушка' };
  } catch {
    return { status: 'ошибка' };
  }
}

async function wikidata(isbn) {
  const hyph = hyphenateRu(isbn);
  const values = [isbn, hyph].filter(Boolean).map((v) => `"${v}"`).join(' ');
  const q = `SELECT ?iLabel ?pubLabel ?pages WHERE {
    VALUES ?isbn { ${values} } ?i wdt:P212 ?isbn.
    OPTIONAL { ?i wdt:P123 ?pub } OPTIONAL { ?i wdt:P1104 ?pages }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
  } LIMIT 1`;
  try {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
    const j = await getJson(url, 25000);
    if (j.__status) return { status: 'ошибка', note: `HTTP ${j.__status}` };
    const b = j.results?.bindings?.[0];
    if (!b) return { status: 'нет' };
    return { status: 'да', title: b.iLabel?.value, publisher: b.pubLabel?.value, pages: b.pages?.value };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

async function getText(url, ms = 30000) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const tags = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** Из нескольких вариантов заглавия берём кириллический, если он есть. */
const preferCyrillic = (list) => list.find((s) => /[А-Яа-яЁё]/.test(s)) ?? list[0];

/**
 * K10plus — сводный каталог библиотек Германии. Сильная славистика, и, в отличие
 * от магазинов, знает издания, которых давно нет в продаже. Часто хранит заглавие
 * сразу в двух формах — транслитерации и кириллице.
 */
async function k10plus(isbn) {
  try {
    const xml = await getText(
      `https://sru.k10plus.de/gvk?version=1.1&operation=searchRetrieve&query=pica.isb%3D${isbn}&maximumRecords=1&recordSchema=dc`
    );
    if (!/<(?:zs:)?numberOfRecords>[1-9]/.test(xml)) return { status: 'нет' };
    const titles = tags(xml, 'title');
    return {
      status: 'да',
      title: preferCyrillic(titles),
      authors: preferCyrillic(tags(xml, 'creator')) || preferCyrillic(tags(xml, 'contributor')),
      publisher: preferCyrillic(tags(xml, 'publisher')),
      year: tags(xml, 'date')[0]?.match(/\d{4}/)?.[0],
      note: [
        tags(xml, 'format').some((f) => /print/i.test(f)) && 'печатное',
        titles.some((t) => /[А-Яа-яЁё]/.test(t)) && 'кириллица есть',
      ].filter(Boolean).join(', '),
    };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

/** Library of Congress — SRU без ключа и без регистрации. */
async function loc(isbn) {
  try {
    const xml = await getText(
      `http://lx2.loc.gov:210/lcdb?operation=searchRetrieve&version=1.1&query=bath.isbn=${isbn}&maximumRecords=1&recordSchema=mods`
    );
    const titles = tags(xml, 'title');
    if (!titles.length) return { status: 'нет' };
    const extent = tags(xml, 'extent')[0];
    return {
      status: 'да',
      title: preferCyrillic(titles),
      authors: tags(xml, 'namePart')[0],
      publisher: tags(xml, 'publisher')[0],
      year: tags(xml, 'dateIssued')[0]?.match(/\d{4}/)?.[0],
      pages: extent?.match(/\d+/)?.[0],
    };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

/**
 * LiveLib — не API, а разбор schema.org-разметки публичной страницы.
 *
 * Держится на JSON-LD, а не на CSS-селекторах: эта разметка существует ради
 * поисковиков, поэтому переживает редизайны, от которых обычный парсер умирает.
 * Стоит два запроса на книгу: поиск, затем карточка.
 *
 * robots.txt разрешает /find/ и /book/ (закрыты списки изданий и разделы
 * пользователей) — но это всё равно веб-страница, а не интерфейс для машин,
 * так что держим запросы редкими и кэшируем результат навсегда.
 */
async function livelib(isbn) {
  const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  try {
    const search = await get(`https://www.livelib.ru/find/${isbn}`);
    // Ссылки вида /book/1000978128-lyubov-…; /book/875079/editions нам не нужны.
    const href = (search.match(/href="(\/book\/\d+-[^"]+)"/) || [])[1];
    if (!href) return { status: 'нет' };

    await new Promise((r) => setTimeout(r, 400));
    const card = await get(`https://www.livelib.ru${href}`);
    const raw = (card.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/) || [])[1];
    if (!raw) return { status: 'нет', note: 'разметка не найдена' };

    const parsed = JSON.parse(raw);
    const book = (parsed['@graph'] ?? [parsed]).find((n) => n['@type'] === 'Book');
    if (!book) return { status: 'нет', note: 'нет узла Book' };

    const binding = String(book.bookFormat ?? '').split('/').pop();
    return {
      status: 'да',
      title: book.name,
      authors: book.author?.name ?? book.author,
      publisher: book.publisher?.name ?? book.publisher,
      year: String(book.datePublished ?? '').match(/\d{4}/)?.[0],
      pages: book.numberOfPages,
      cover: Boolean(book.image?.url ?? book.image),
      note: [
        binding && binding !== 'undefined' && binding,
        book.genre,
        book.description && 'аннотация',
        book.aggregateRating && `оценка ${book.aggregateRating.ratingValue}`,
      ].filter(Boolean).join(', '),
      translit: isTranslit(book.name),
    };
  } catch (e) {
    return { status: 'ошибка', note: e.message };
  }
}

/** Библиотечная транслитерация ALA-LC: латиница с диакритикой вместо кириллицы. */
function isTranslit(title) {
  if (!title) return false;
  const hasCyrillic = /[А-Яа-яЁё]/.test(title);
  const hasLibraryDiacritics = /[︠︡ʹʺĭĕėīūāōē]/.test(title);
  return hasLibraryDiacritics || (!hasCyrillic && /^[A-Za-z\s.,:'-]+$/.test(title) === false);
}

const SOURCES = [
  ['Google Books', googleBooks],
  ['OpenLibrary', openLibrary],
  ['OL Covers', olCover],
  ['LiveLib', livelib],
  ['K10plus', k10plus],
  ['LoC', loc],
  ['Wikidata', wikidata],
];

// ------------------------------------------------------------------- вывод

function pad(s, n) {
  s = String(s ?? '');
  const w = [...s].length;
  return w >= n ? [...s].slice(0, n - 1).join('') + '…' : s + ' '.repeat(n - w);
}

async function main() {
  let args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  if (fi !== -1) {
    const text = await readFile(args[fi + 1], 'utf8');
    args = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  }
  const isbns = args.map(clean).filter((s) => s.length === 10 || s.length === 13);

  if (!isbns.length) {
    console.error('Укажи ISBN: node scripts/probe-isbn.mjs 9785699539628 …');
    console.error('или файл:   node scripts/probe-isbn.mjs --file my-shelf.txt');
    process.exit(1);
  }
  if (!KEY) console.error('! GOOGLE_BOOKS_KEY не задан — Google Books почти наверняка ответит 429\n');

  const tally = Object.fromEntries(SOURCES.map(([n]) => [n, 0]));
  let translit = 0;

  for (const isbn of isbns) {
    console.log('\n' + '─'.repeat(78));
    console.log(isbn);
    for (const [name, fn] of SOURCES) {
      const r = await fn(isbn);
      if (r.status === 'да') tally[name]++;
      if (r.translit) translit++;

      const mark = { 'да': '  ✓', 'нет': '  ·', 'квота': ' ⚠', 'ошибка': ' ⚠' }[r.status] ?? '  ?';
      const detail = r.status === 'да'
        ? [r.title, r.authors, [r.publisher, r.year].filter(Boolean).join(', '),
           r.pages && `${r.pages} с.`, r.cover && 'обложка', r.note,
           r.translit && '⚠ транслит'].filter(Boolean).join(' · ')
        : (r.note ?? '');
      console.log(`${mark} ${pad(name, 14)} ${detail}`);
      await new Promise((r) => setTimeout(r, 120)); // вежливость к чужим серверам
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log(`Покрытие на ${isbns.length} книгах:\n`);
  for (const [name, n] of Object.entries(tally)) {
    const pct = Math.round((n / isbns.length) * 100);
    console.log(`  ${pad(name, 14)} ${pad(`${n}/${isbns.length}`, 8)} ${'█'.repeat(Math.round(pct / 4))} ${pct}%`);
  }
  if (translit) console.log(`\n  ⚠ записей в библиотечной транслитерации: ${translit} — их придётся править руками`);
}

main();

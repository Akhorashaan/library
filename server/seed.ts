/**
 * Наполнение каталога для проверки интерфейса.
 *
 * Данные вписаны прямо здесь, а не тянутся каскадом: пять сетевых источников
 * на книгу — это полторы минуты ожидания и разный результат от запуска
 * к запуску. Каскад проверяется отдельно, через scripts/probe-isbn.mjs.
 *
 *   npm run seed          добавить
 *   npm run seed -- --wipe   снести каталог и добавить заново
 */

import { initSchema, sqlite, db } from './db/index.js';
import { books, copies, reading } from './db/schema.js';
import { shelfmark, sortKey } from './metadata/normalize.js';
import { fetchCover } from './covers.js';

type Seed = {
  isbn?: string;
  title: string;
  authors: string;
  publisher?: string;
  year?: number;
  pages?: number;
  binding?: string;
  genre?: string;
  annotation?: string;
  cover?: string;
  status?: 'none' | 'queued' | 'reading' | 'read' | 'abandoned';
  progress?: number;
  note?: string;
  lentTo?: string;
  daysAgoFinished?: number;
};

const SEEDS: Seed[] = [
  {
    isbn: '9785699754670',
    title: 'Любовь к трем цукербринам',
    authors: 'Виктор Пелевин',
    publisher: 'Эксмо', year: 2014, pages: 446, binding: 'Твёрдый',
    genre: 'Современная русская литература',
    annotation: 'О головокружительной, завораживающей и роковой страсти к трем цукербринам.',
    cover: 'https://s1.livelib.ru/boocover/1000978128/200x305/64a8/Viktor_Pelevin__Lyubov_k_trem_tsukerbrinam.jpg', status: 'reading', progress: 124,
  },
  {
    isbn: '9785699539628',
    title: 'S.N.U.F.F.',
    authors: 'Виктор Пелевин',
    publisher: 'Эксмо', year: 2012, pages: 477, binding: 'Твёрдый',
    genre: 'Современная русская литература', status: 'read', daysAgoFinished: 40,
    note: 'Лучшее у позднего Пелевина. Перечитать через пару лет.',
  },
  {
    isbn: '9785041231187',
    title: 'Transhumanism inc.',
    authors: 'Виктор Пелевин',
    publisher: 'Эксмо', year: 2021, pages: 605, binding: 'Твёрдый',
    genre: 'Современная русская литература', status: 'queued',
  },
  {
    isbn: '9785389074354',
    title: 'Колымские рассказы',
    authors: 'Варлам Шаламов',
    publisher: 'Азбука', year: 2022, pages: 608, binding: 'Твёрдый',
    genre: 'Русская классика', status: 'read', daysAgoFinished: 8,
    note: '«Лагерь — отрицательная школа жизни целиком и полностью». Читать по одному рассказу за раз, залпом нельзя.',
  },
  {
    title: 'Братья Карамазовы',
    authors: 'Фёдор Достоевский',
    publisher: 'Азбука', year: 2021, pages: 832, binding: 'Твёрдый',
    genre: 'Русская классика', status: 'read', daysAgoFinished: 200,
  },
  {
    title: 'Бесы',
    authors: 'Фёдор Достоевский',
    publisher: 'Азбука', year: 2019, pages: 704, binding: 'Мягкий',
    genre: 'Русская классика', status: 'queued',
  },
  {
    title: 'Солярис',
    authors: 'Станислав Лем',
    publisher: 'АСТ', year: 2019, pages: 288, binding: 'Твёрдый',
    genre: 'Научная фантастика', status: 'queued',
  },
  {
    title: 'Хазарский словарь',
    authors: 'Милорад Павич',
    publisher: 'Азбука', year: 2018, pages: 384, binding: 'Твёрдый',
    genre: 'Магический реализм', status: 'queued',
  },
  {
    title: 'Осень патриарха',
    authors: 'Габриэль Гарсиа Маркес',
    publisher: 'АСТ', year: 2020, pages: 320, binding: 'Твёрдый',
    genre: 'Магический реализм', status: 'none', lentTo: 'Миши',
  },
  {
    title: 'Бесконечная шутка',
    authors: 'Дэвид Фостер Уоллес',
    publisher: 'АСТ', year: 2018, pages: 1280, binding: 'Твёрдый',
    genre: 'Постмодернизм', status: 'abandoned',
    note: 'Дошёл до 300-й страницы. Вернусь, когда будет отпуск и много терпения.',
  },
  {
    title: 'Sapiens. Краткая история человечества',
    authors: 'Юваль Ной Харари',
    publisher: 'Синдбад', year: 2019, pages: 512, binding: 'Твёрдый',
    genre: 'Нонфикшн', status: 'read', daysAgoFinished: 120,
  },
  {
    title: 'Думай медленно… решай быстро',
    authors: 'Даниэль Канеман',
    publisher: 'АСТ', year: 2021, pages: 656, binding: 'Твёрдый',
    genre: 'Нонфикшн', status: 'reading', progress: 210,
  },
  {
    title: 'Тихий Дон',
    authors: 'Михаил Шолохов',
    publisher: 'АСТ', year: 2017, pages: 1536, binding: 'Твёрдый',
    genre: 'Русская классика',
  },
  {
    title: 'Generation «П»',
    authors: 'Виктор Пелевин',
    publisher: 'Эксмо', year: 2020, pages: 352, binding: 'Мягкий',
    genre: 'Современная русская литература', status: 'read', daysAgoFinished: 300,
  },
];

const iso = (daysAgo = 0) => new Date(Date.now() - daysAgo * 864e5).toISOString();

async function main() {
  initSchema();

  if (process.argv.includes('--wipe')) {
    sqlite.exec('DELETE FROM books');
    console.log('каталог очищен');
  }

  let added = 0;
  let queuePos = 0;

  for (const s of SEEDS) {
    const exists = s.isbn
      ? sqlite.prepare('SELECT id FROM books WHERE isbn = ?').get(s.isbn)
      : sqlite.prepare('SELECT id FROM books WHERE title = ? AND authors = ?').get(s.title, s.authors);
    if (exists) continue;

    const cover = s.cover ? await fetchCover(s.cover, s.isbn ?? s.title.slice(0, 20)) : null;

    const row = db
      .insert(books)
      .values({
        isbn: s.isbn ?? null,
        title: s.title,
        authors: s.authors,
        publisher: s.publisher ?? null,
        year: s.year ?? null,
        pages: s.pages ?? null,
        binding: s.binding ?? null,
        genre: s.genre ?? null,
        annotation: s.annotation ?? null,
        coverUrl: cover,
        source: s.isbn ? JSON.stringify({ title: 'livelib', year: 'openlibrary' }) : null,
        shelfmark: shelfmark(s.authors, s.title),
        sortKey: sortKey(s.authors, s.title),
        createdAt: iso(),
      })
      .returning()
      .get();

    db.insert(copies)
      .values({
        bookId: row.id,
        lentTo: s.lentTo ?? null,
        lentAt: s.lentTo ? iso(22) : null,
        acquiredAt: iso(400),
      })
      .run();

    const status = s.status ?? 'none';
    db.insert(reading)
      .values({
        bookId: row.id,
        status,
        progress: s.progress ?? null,
        note: s.note ?? null,
        startedAt: status === 'reading' || status === 'read' ? iso((s.daysAgoFinished ?? 20) + 30) : null,
        finishedAt: status === 'read' ? iso(s.daysAgoFinished ?? 30) : null,
        queuePos: status === 'queued' ? ++queuePos : null,
      })
      .run();

    added++;
  }

  const total = (sqlite.prepare('SELECT count(*) n FROM books').get() as { n: number }).n;
  console.log(`добавлено ${added}, всего в каталоге ${total}`);
}

await main();

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH ?? resolve('data/kartoteka.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const sqlite = new Database(DB_PATH);

// WAL — чтобы чтение каталога не блокировалось записью при добавлении книги.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/**
 * Схема создаётся идемпотентным DDL, а не миграционными файлами: приложение
 * домашнее, а FTS5-таблицу и триггеры drizzle-kit всё равно не умеет описывать.
 */
export function initSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT,
      title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '',
      publisher TEXT,
      year INTEGER,
      pages INTEGER,
      binding TEXT,
      genre TEXT,
      annotation TEXT,
      cover_url TEXT,
      source TEXT,
      shelfmark TEXT NOT NULL DEFAULT '',
      sort_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS books_isbn_uq ON books(isbn) WHERE isbn IS NOT NULL;
    CREATE INDEX IF NOT EXISTS books_title_idx ON books(title);
    CREATE INDEX IF NOT EXISTS books_sort_idx ON books(sort_key);

    CREATE TABLE IF NOT EXISTS copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      condition TEXT,
      lent_to TEXT, lent_at TEXT, acquired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS copies_book_idx ON copies(book_id);
    CREATE INDEX IF NOT EXISTS copies_lent_idx ON copies(lent_to);

    CREATE TABLE IF NOT EXISTS reading (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'none',
      progress INTEGER, note TEXT,
      started_at TEXT, finished_at TEXT, queue_pos INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reading_book_uq ON reading(book_id);
    CREATE INDEX IF NOT EXISTS reading_status_idx ON reading(status);
    CREATE INDEX IF NOT EXISTS reading_queue_idx ON reading(queue_pos);

    CREATE TABLE IF NOT EXISTS external_reading (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '',
      finished_at TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Ключ по ISBN: дубликаты в стопке невозможны на уровне схемы,
    -- а не потому, что код не забыл проверить.
    CREATE TABLE IF NOT EXISTS unresolved (
      isbn TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      last_tried TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS lookup_cache (
      isbn TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);

  // Существующие записи сохраняются; FTS является производным индексом.
  sqlite.exec('CREATE TABLE IF NOT EXISTS series_references (name TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  sqlite.exec('CREATE TABLE IF NOT EXISTS series_preferences (name TEXT PRIMARY KEY, following INTEGER NOT NULL DEFAULT 1 CHECK (following IN (0, 1)))');
  sqlite.transaction(() => {
    const readingColumns = sqlite.pragma('table_info(external_reading)') as { name: string }[];
    if (!readingColumns.some(column => column.name === 'isbn')) {
      sqlite.exec('ALTER TABLE external_reading ADD COLUMN isbn TEXT');
    }
    const columns = new Set((sqlite.pragma('table_info(books)') as { name: string }[]).map((c) => c.name));
    for (const [name, type] of Object.entries({ series: 'TEXT', series_order: 'INTEGER', series_end: 'INTEGER', series_part: 'INTEGER', tags: "TEXT NOT NULL DEFAULT '[]'" })) {
      if (!columns.has(name)) sqlite.exec(`ALTER TABLE books ADD COLUMN ${name} ${type}`);
    }
    if (Number(sqlite.pragma('user_version', { simple: true })) < 1) {
      sqlite.exec(`
        DROP TRIGGER IF EXISTS books_fts_ai;
        DROP TRIGGER IF EXISTS books_fts_ad;
        DROP TRIGGER IF EXISTS books_fts_au;
        DROP TABLE IF EXISTS books_fts;
        CREATE VIRTUAL TABLE books_fts USING fts5(
          title, authors, publisher, genre, series, tags,
          tokenize='unicode61 remove_diacritics 2'
        );
        INSERT INTO books_fts(rowid, title, authors, publisher, genre, series, tags)
          SELECT id, title, authors, publisher, genre, series, tags FROM books;
        CREATE TRIGGER books_fts_ai AFTER INSERT ON books BEGIN
          INSERT INTO books_fts(rowid, title, authors, publisher, genre, series, tags)
            VALUES (new.id, new.title, new.authors, new.publisher, new.genre, new.series, new.tags);
        END;
        CREATE TRIGGER books_fts_ad AFTER DELETE ON books BEGIN
          DELETE FROM books_fts WHERE rowid = old.id;
        END;
        CREATE TRIGGER books_fts_au AFTER UPDATE ON books BEGIN
          DELETE FROM books_fts WHERE rowid = old.id;
          INSERT INTO books_fts(rowid, title, authors, publisher, genre, series, tags)
            VALUES (new.id, new.title, new.authors, new.publisher, new.genre, new.series, new.tags);
        END;
        CREATE INDEX IF NOT EXISTS books_series_idx ON books(series, series_order);
        PRAGMA user_version = 1;
      `);
    }
  })();
}

/**
 * Пользователь пишет «толстой война», а FTS5 ждёт свой синтаксис. Разбираем
 * ввод на слова и клеим префиксным поиском, экранируя кавычки: иначе
 * апостроф в названии роняет весь запрос.
 */
export function toFtsQuery(input: string): string | null {
  const words = input
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/["*()]/g, ''))
    .filter((w) => w.length > 0);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' AND ');
}

import { mkdirSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/**
 * Обложки складываем к себе один раз при добавлении книги.
 *
 * Self-hosted каталог не должен превращаться в решето битых картинок, когда
 * чужой CDN переедет или закроется. Заодно обложки работают офлайн — а именно
 * офлайн ты стоишь у полки.
 */
export const COVERS_DIR = process.env.COVERS_DIR ?? resolve('data/covers');
mkdirSync(COVERS_DIR, { recursive: true });

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Скачивает обложку и возвращает локальный путь `/covers/…`.
 * При любой неудаче возвращает null — книга добавится и без картинки,
 * заглушка нарисуется типографикой.
 */
export async function fetchCover(url: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'kartoteka/0.1 (home library catalogue)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;

    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const ext = EXT[type];
    if (!ext) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    // Заглушки OpenLibrary — это пара пиксельных полосок в сотню байт.
    if (buf.byteLength < 3000) return null;

    const name = `${key.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`;
    const path = join(COVERS_DIR, name);
    if (!existsSync(path)) await writeFile(path, buf);
    return `/covers/${name}`;
  } catch {
    return null;
  }
}

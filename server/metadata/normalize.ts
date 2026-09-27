import { authorSurname, normalizeAuthors } from '../../shared/authors.js';

/**
 * Очистка того, что приходит из источников.
 *
 * Данные о русских книгах приходят грязными: библиотечная транслитерация вместо
 * кириллицы, издательство в трёх написаниях, фамилия то впереди, то сзади.
 * Без этого слоя каталог выглядит как свалка, даже когда все поля заполнены.
 */

/**
 * Библиотечная транслитерация ALA-LC: «Li︠u︡bovʹ k trem t︠s︡ukerbrinam».
 * Опознаётся по диакритике и модификаторам, которых в обычной латинице нет.
 */
export function isTranslit(s: string | undefined | null): boolean {
  if (!s) return false;
  if (/[А-Яа-яЁё]/.test(s)) return false;
  return /[︠︡͢͡ʹʺ]|[ĭĕėīūāōēşţḥḳṇṣṭż]/.test(s);
}

/** Есть ли в строке кириллица — главный признак пригодности для русской полки. */
export const hasCyrillic = (s: string | undefined | null): boolean => Boolean(s && /[А-Яа-яЁё]/.test(s));

/** Схлопывает пробелы, снимает обёртки и висячую пунктуацию. */
export function tidy(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const out = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'«»]+|[\s"'«»,;:/]+$/g, '')
    .trim();
  return out || undefined;
}

const PUBLISHER_ALIASES: Array<[RegExp, string]> = [
  [/^(ėksmo|eksmo|эксмо)/i, 'Эксмо'],
  [/^(ast| act|аст)\b/i, 'АСТ'],
  [/^(azbuka|азбука)/i, 'Азбука'],
  [/^(alʹpina|alpina|альпина)/i, 'Альпина'],
  [/^(corpus|корпус)/i, 'Corpus'],
  [/^(molodai?a? gvardii?a|молодая гвардия)/i, 'Молодая гвардия'],
  [/^(nauka|наука)$/i, 'Наука'],
];

/**
 * «ĖKSMO», «EKSMO, M», «Эксмо» — это одно издательство. Без приведения
 * фасет «по издательству» распадается на три строки вместо одной.
 */
export function normalizePublisher(s: string | undefined | null): string | undefined {
  const t = tidy(s);
  if (!t) return undefined;
  // Хвосты вида «, M» или «, Москва» — это место издания, а не имя.
  const head = t.replace(/\s*,\s*(m|москва|moskva|спб|sankt-peterburg)\.?$/i, '');
  for (const [re, name] of PUBLISHER_ALIASES) if (re.test(head)) return name;
  return head;
}

/** Confirmed aliases and author lists; surname-first conversion belongs to library source adapters. */
export function normalizeAuthor(s: string | undefined | null): string | undefined {
  return normalizeAuthors(s) || undefined;
}

/**
 * Фамилия первого автора — последнее слово его имени.
 *
 * Каталог упорядочен по фамилии, а не по тому, как имя записано: «Варлам
 * Шаламов» должен стоять под Ш, а не под В. Источники пишут имя и так и эдак,
 * поэтому ключ сортировки вычисляем сами и храним в базе.
 */
export function surname(authors: string | undefined | null, fallback = ''): string {
  return authorSurname(authors ?? '', fallback);
}

/** Ключ сортировки каталога: фамилия, затем остаток имени. */
export function sortKey(authors: string | undefined | null, title: string): string {
  const s = surname(authors, '');
  return (s ? `${s} ${tidy(authors) ?? ''}` : `￿ ${title}`).toLocaleLowerCase('ru');
}

/**
 * Библиотечный шифр из фамилии автора: «Варлам Шаламов» → «ША 12».
 * Две первые буквы фамилии плюс устойчивое число от названия — так книги
 * одного автора встают рядом, а найти томик глазами можно по корешку.
 */
export function shelfmark(authors: string | undefined, title: string): string {
  const letters = surname(authors, title).slice(0, 2).toUpperCase();
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) % 100;
  return `${letters} ${String(hash).padStart(2, '0')}`;
}

/** Аннотации у источников бывают на пол-экрана — на карточке нужен абзац. */
export function trimAnnotation(s: string | undefined | null, max = 600): string | undefined {
  const t = tidy(s);
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut) + '…';
}

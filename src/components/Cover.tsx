/**
 * Обложка книги. Если картинки нет — рисуем типографскую заглушку.
 *
 * Цвет переплёта выводится из автора, а не случайный: одна и та же книга
 * всегда одного цвета, а полка одного автора читается единым блоком.
 */

const PALETTE = [
  ['#7A2E28', '#4A1A16'],
  ['#2E4A5C', '#182B38'],
  ['#5B5230', '#332D18'],
  ['#46344F', '#271B2E'],
  ['#2F4D3A', '#182B20'],
  ['#6B4522', '#3A2411'],
  ['#3C4A63', '#1E2637'],
  ['#5E3040', '#331823'],
] as const;

function palette(seed: string): readonly [string, string] {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)!) % 100000;
  return PALETTE[hash % PALETTE.length]!;
}

type Props = {
  title: string;
  authors?: string | null;
  src?: string | null;
  className?: string;
};

export function Cover({ title, authors, src, className }: Props) {
  const [c1, c2] = palette(authors?.trim() || title);

  if (src) {
    return (
      <div className={`cover ${className ?? ''}`} style={{ padding: 0 }}>
        <img
          src={src.startsWith('/covers/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }

  return (
    <div className={`cover ${className ?? ''}`} style={{ ['--c1' as string]: c1, ['--c2' as string]: c2 }}>
      <div className="t">{title}</div>
      <div className="a">{authors || ' '}</div>
    </div>
  );
}

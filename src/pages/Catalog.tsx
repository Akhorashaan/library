import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { SORT_LABEL, type ReadingStatus, type SortKey } from '@shared/schema';
import { authorSurname } from '@shared/authors';
import { api, type Book, type Filters } from '@/lib/api';
import { BookCard } from '@/components/BookCard';
import { CardSkeleton, Empty, Icons } from '@/components/ui';

const STATUS_CHIPS: Array<{ key: string; label: string; status?: ReadingStatus; lent?: true }> = [
  { key: 'all', label: 'Все' },
  { key: 'reading', label: 'Читаю', status: 'reading' },
  { key: 'queued', label: 'В очереди', status: 'queued' },
  { key: 'read', label: 'Прочитано', status: 'read' },
  { key: 'none', label: 'Не начата', status: 'none' },
  { key: 'abandoned', label: 'Брошена', status: 'abandoned' },
  { key: 'lent', label: 'Не дома', lent: true },
];

const EMPTY: Filters = { sort: 'series' };

export function Catalog() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [panelOpen, setPanelOpen] = useState(false);

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const books = useQuery({
    queryKey: ['books', q, filters],
    queryFn: () => api.books({ ...filters, q }),
  });

  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));

  // Счётчик на кнопке: сортировка — не фильтр, её сюда не считаем.
  const activeCount = [filters.genre, filters.author, filters.publisher, filters.series, filters.missing, filters.yearFrom, filters.yearTo].filter(Boolean).length + (filters.tags?.length ?? 0);
  const sort: SortKey = filters.sort ?? 'series';

  /**
   * Секции каталога следуют за сортировкой: по автору — буквенные разделители,
   * как картонки в ящике; по году — годы; недавние идут сплошным списком,
   * потому что там важен сам порядок, а не группы.
   */
  const groups = useMemo(() => groupBooks(books.data ?? [], sort), [books.data, sort]);

  const statusChipActive = (c: (typeof STATUS_CHIPS)[number]) =>
    c.key === 'all'
      ? !filters.status && !filters.lent
      : c.lent
        ? Boolean(filters.lent)
        : filters.status === c.status && !filters.lent;

  const chipCount = (c: (typeof STATUS_CHIPS)[number]) => {
    const s = stats.data;
    if (!s) return undefined;
    if (c.key === 'all') return s.total;
    if (c.lent) return s.lent;
    return s[c.status as keyof typeof s] as number | undefined;
  };

  return (
    <>
      <header className="app-bar">
        <div>
          <div className="title">Картотека</div>
          <div className="sub">
            {stats.data
              ? `${stats.data.total} ${plural(stats.data.total, 'книга', 'книги', 'книг')}` +
                (stats.data.readThisYear ? ` · ${stats.data.readThisYear} за год` : '')
              : ' '}
          </div>
        </div>
        <button className="icon-btn" onClick={() => navigate('/scan')} aria-label="Добавить книгу">
          {Icons.plus}
        </button>
      </header>

      <div className="catalog-controls">
      <div className="catalog-search">
        <div className="search">
          {Icons.search}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="автор, название, серия, тег…"
            type="search"
            enterKeyHint="search"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Очистить" style={{ color: 'var(--ink-faint)', lineHeight: 0 }}>
              {Icons.close}
            </button>
          )}
        </div>
      </div>

      <div className="facets scroll-hidden">
        {STATUS_CHIPS.map((c) => {
          const n = chipCount(c);
          if (c.key !== 'all' && !n) return null; // пустую стопку не показываем
          return (
            <button
              key={c.key}
              className="facet"
              data-on={statusChipActive(c) ? '' : undefined}
              onClick={() =>
                set(c.key === 'all' ? { status: undefined, lent: undefined } : c.lent ? { status: undefined, lent: true } : { status: c.status, lent: undefined })
              }
            >
              {c.label}
              {n !== undefined && <b>{n}</b>}
            </button>
          );
        })}
      </div>

      <div className="filter-bar">
        <button className="filter-toggle" data-on={panelOpen || activeCount ? '' : undefined} onClick={() => setPanelOpen((v) => !v)}>
          {Icons.filter}
          Фильтры
          {activeCount > 0 && <b>{activeCount}</b>}
        </button>
        <select className="sort-select" value={sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="Сортировка">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      </div>

      {panelOpen && stats.data && (
        <div className="filter-panel">
          <FacetSelect label="Серия" value={filters.series} options={stats.data.series ?? []} onChange={(v) => set({ series: v, sort: 'series' })} />
          <div className="field">
            <label htmlFor="missing-filter">Заполнение карточки</label>
            <select id="missing-filter" className="input" value={filters.missing ?? ''} onChange={(e) => set({ missing: e.target.value as Filters['missing'] || undefined })}>
              <option value="">Все карточки</option><option value="series">Без серии</option><option value="tags">Без тегов</option><option value="authors">Без автора</option><option value="pages">Без числа страниц</option>
            </select>
          </div>
          <div className="field"><label htmlFor="year-from">Год издания от</label><input id="year-from" className="input" type="number" placeholder="любой" value={filters.yearFrom ?? ''} onChange={(e) => set({ yearFrom: e.target.value ? Number(e.target.value) : undefined })} /></div>
          <div className="field"><label htmlFor="year-to">Год издания до</label><input id="year-to" className="input" type="number" placeholder="любой" value={filters.yearTo ?? ''} onChange={(e) => set({ yearTo: e.target.value ? Number(e.target.value) : undefined })} /></div>
          <fieldset className="tag-filter"><legend>Теги — совпадают все выбранные</legend><div className="tag-list">
            {(stats.data.tags ?? []).map((t) => <button key={t.value} className="facet" aria-pressed={filters.tags?.includes(t.value) ?? false} data-on={filters.tags?.includes(t.value) ? '' : undefined} onClick={() => set({ tags: filters.tags?.includes(t.value) ? filters.tags.filter((v) => v !== t.value) : [...(filters.tags ?? []), t.value] })}>{t.value} <b>{t.count}</b></button>)}
          </div></fieldset>
          <FacetSelect
            label="Жанр"
            value={filters.genre}
            options={stats.data.genres}
            onChange={(v) => set({ genre: v })}
          />
          <FacetSelect
            label="Автор"
            value={filters.author}
            options={stats.data.authors}
            onChange={(v) => set({ author: v })}
          />
          <FacetSelect
            label="Издательство"
            value={filters.publisher}
            options={stats.data.publishers}
            onChange={(v) => set({ publisher: v })}
          />
          {(activeCount > 0 || filters.status || filters.lent) && (
            <button className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }} onClick={() => setFilters(EMPTY)}>
              Сбросить всё
            </button>
          )}
        </div>
      )}

      {activeCount > 0 && !panelOpen && (
        <div className="active-filters">
          {filters.series && <FilterPill label={filters.series} onClear={() => set({ series: undefined })} />}
          {filters.tags?.map((tag) => <FilterPill key={tag} label={`#${tag}`} onClear={() => set({ tags: filters.tags?.filter((t) => t !== tag) })} />)}
          {filters.missing && <FilterPill label={{ series: 'Без серии', tags: 'Без тегов', authors: 'Без автора', pages: 'Без числа страниц' }[filters.missing]} onClear={() => set({ missing: undefined })} />}
          {filters.yearFrom !== undefined && <FilterPill label={`От ${filters.yearFrom}`} onClear={() => set({ yearFrom: undefined })} />}
          {filters.yearTo !== undefined && <FilterPill label={`До ${filters.yearTo}`} onClear={() => set({ yearTo: undefined })} />}
          {filters.genre && <FilterPill label={filters.genre} onClear={() => set({ genre: undefined })} />}
          {filters.author && <FilterPill label={filters.author} onClear={() => set({ author: undefined })} />}
          {filters.publisher && <FilterPill label={filters.publisher} onClear={() => set({ publisher: undefined })} />}
        </div>
      )}

      {/* Напоминание появляется само, когда в стопке что-то есть,
          и не занимает места в навигации, пока она пуста. */}
      {stats.data && stats.data.unresolved > 0 && (
        <button className="unresolved-banner" onClick={() => navigate('/unresolved')}>
          <span className="n">{stats.data.unresolved}</span>
          <span>
            {plural(stats.data.unresolved, 'штрих-код ждёт', 'штрих-кода ждут', 'штрих-кодов ждут')} разбора
          </span>
          <span className="arrow" aria-hidden="true">→</span>
        </button>
      )}

      <main className="page">
        <div className="drawer drawer--grid">
          {books.isLoading && [0, 1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}

          {books.isError && (
            <Empty title="Каталог не отвечает">
              {books.error.message}
            </Empty>
          )}

          {books.isSuccess && books.data.length === 0 && (
            q.trim() ? (
              <Empty title="Ничего не нашлось">
                По запросу «{q}» в каталоге пусто. Попробуйте фамилию автора или часть названия.
              </Empty>
            ) : activeCount || filters.status || filters.lent ? (
              <Empty title="Под фильтры ничего не подходит">
                <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }} onClick={() => setFilters(EMPTY)}>
                  Сбросить фильтры
                </button>
              </Empty>
            ) : (
              <Empty title="Каталог пуст">
                Отсканируйте штрих-код на задней обложке — он же ISBN, остальное подтянется само.
              </Empty>
            )
          )}

          {groups.map(([label, items]) => (
            <section key={label} style={{ display: 'contents' }}>
              {label && (
                <div className="drawer-tab">
                  <span>{label}</span>
                  <hr />
                </div>
              )}
              {items.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Array<{ value: string; count: number }>;
  onChange: (v: string | undefined) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="field">
      <label htmlFor={`facet-${label}`}>{label}</label>
      <select id={`facet-${label}`} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">любой</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-pill" onClick={onClear}>
      {label}
      <span aria-hidden="true">×</span>
    </button>
  );
}

function groupBooks(books: Book[], sort: SortKey): Array<[string, Book[]]> {
  if (sort === 'added') return books.length ? [['', books]] : [];

  const key = (b: Book): string => {
    if (sort === 'series') return b.series || 'Вне серий';
    if (sort === 'year') return b.year ? String(b.year) : 'Год неизвестен';
    const base = sort === 'title' ? b.title : authorSurname(b.authors);
    const letter = base.trim().charAt(0).toUpperCase();
    return letter || '—';
  };

  const map = new Map<string, Book[]>();
  for (const b of books) {
    const k = key(b);
    const list = map.get(k);
    if (list) list.push(b);
    else map.set(k, [b]);
  }
  return [...map.entries()];
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Unresolved as Pending } from '@shared/schema';
import { api } from '@/lib/api';
import { Empty, Icons, shortDate } from '@/components/ui';

/**
 * Стопка «на разбор» — ISBN, которых не знает ни один источник.
 *
 * Так бывает с самиздатом, старыми и подарочными изданиями. Штрих-код
 * отложен, чтобы не пропасть: можно попробовать поиск ещё раз (источники
 * пополняются) или завести книгу руками.
 */
export function Unresolved() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['unresolved'], queryFn: api.unresolved });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['unresolved'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const drop = useMutation({ mutationFn: api.dropUnresolved, onSuccess: refresh });

  return (
    <>
      <header className="app-bar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Назад">
          {Icons.back}
        </button>
        <div>
          <div className="title" style={{ fontSize: 19 }}>На разбор</div>
          <div className="sub">{data ? `${data.length} ${plural(data.length, 'штрих-код', 'штрих-кода', 'штрих-кодов')}` : ' '}</div>
        </div>
        <span style={{ width: 34 }} />
      </header>

      <main className="page">
        <div className="drawer">
          {isLoading && <p style={{ padding: '24px 0', color: 'var(--ink-soft)' }}>Достаём стопку…</p>}

          {data && data.length === 0 && (
            <Empty title="Стопка пуста">
              Сюда попадают ISBN, которых не знает ни один источник. Обычно это самиздат, старые
              и подарочные издания.
            </Empty>
          )}

          {data && data.length > 0 && (
            <>
              <p className="hint-block">
                Эти штрих-коды ни один источник не опознал. Можно попробовать снова — базы пополняются —
                или завести книгу руками.
              </p>
              {data.map((p) => (
                <PendingCard key={p.isbn} item={p} onDrop={() => drop.mutate(p.isbn)} onRefresh={refresh} />
              ))}
            </>
          )}
        </div>
      </main>
    </>
  );
}

function PendingCard({ item, onDrop, onRefresh }: { item: Pending; onDrop: () => void; onRefresh: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const note = useMutation({
    mutationFn: (v: string | null) => api.noteUnresolved(item.isbn, v),
    onSuccess: onRefresh,
  });

  /** Повторный поиск идёт мимо кэша: иначе вернётся тот же старый промах. */
  const retry = async () => {
    setRetrying(true);
    setResult(null);
    try {
      const r = await api.lookup(item.isbn, true);
      if (r.found) {
        const book = await api.create({
          isbn: r.isbn,
          title: r.title ?? `Книга ${r.isbn}`,
          authors: r.authors ?? '',
          publisher: r.publisher,
          year: r.year,
          pages: r.pages,
          binding: r.binding,
          genre: r.genre,
          annotation: r.annotation,
          coverUrl: r.coverUrl,
          source: JSON.stringify(r.sources),
          status: 'none',
        });
        await qc.invalidateQueries();
        navigate(`/book/${book.id}`);
      } else {
        setResult('По-прежнему никто не знает');
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Не вышло');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <article className="pending-card">
      <div className="pending-head">
        <span className="pending-isbn">{item.isbn}</span>
        <span className="pending-meta">
          {shortDate(item.firstSeen)}
          {item.attempts > 1 && ` · попыток: ${item.attempts}`}
        </span>
      </div>

      <input
        className="input"
        defaultValue={item.note ?? ''}
        placeholder="что за книга — чтобы вспомнить, когда дойдут руки"
        style={{ fontFamily: 'var(--font-serif)', fontSize: 13.5, letterSpacing: 0 }}
        onBlur={(e) => {
          const v = e.target.value.trim() || null;
          if (v !== item.note) note.mutate(v);
        }}
      />

      {result && <p className="pending-result">{result}</p>}

      <div className="pending-actions">
        <button className="btn btn--ghost btn--sm" onClick={retry} disabled={retrying}>
          {retrying ? 'Ищем…' : 'Искать снова'}
        </button>
        <button className="btn btn--primary btn--sm" onClick={() => setManual((v) => !v)}>
          {manual ? 'Свернуть' : 'Завести руками'}
        </button>
        <button className="btn btn--quiet btn--sm" onClick={onDrop} style={{ marginLeft: 'auto' }}>
          Убрать
        </button>
      </div>

      {manual && <ManualForm isbn={item.isbn} hint={item.note} />}
    </article>
  );
}

/**
 * Ручной ввод для книги, которой нет ни в одном источнике.
 * Обязательно только название — остальное дописывается когда угодно.
 * ISBN уходит из стопки сам: сервер убирает его при заведении книги.
 */
function ManualForm({ isbn, hint }: { isbn: string; hint: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (form: FormData) =>
      api.create({
        isbn,
        title: String(form.get('title') ?? '').trim(),
        authors: String(form.get('authors') ?? '').trim(),
        publisher: String(form.get('publisher') ?? '').trim() || null,
        year: numOrNull(form.get('year')),
        pages: numOrNull(form.get('pages')),
        status: 'none',
        source: JSON.stringify({ title: 'вручную' }),
      }),
    onSuccess: async (book) => {
      await qc.invalidateQueries();
      navigate(`/book/${book.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Не удалось сохранить'),
  });

  return (
    <form
      className="manual-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate(new FormData(e.currentTarget));
      }}
    >
      <div className="field">
        <label htmlFor={`t-${isbn}`}>Название</label>
        <input id={`t-${isbn}`} name="title" className="input manual-input" defaultValue={hint ?? ''} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor={`a-${isbn}`}>Автор</label>
        <input id={`a-${isbn}`} name="authors" className="input manual-input" placeholder="Имя Фамилия" />
      </div>
      <div className="manual-row">
        <div className="field">
          <label htmlFor={`p-${isbn}`}>Издательство</label>
          <input id={`p-${isbn}`} name="publisher" className="input manual-input" />
        </div>
        <div className="field">
          <label htmlFor={`y-${isbn}`}>Год</label>
          <input id={`y-${isbn}`} name="year" className="input" inputMode="numeric" placeholder="2019" />
        </div>
        <div className="field">
          <label htmlFor={`g-${isbn}`}>Страниц</label>
          <input id={`g-${isbn}`} name="pages" className="input" inputMode="numeric" placeholder="320" />
        </div>
      </div>

      {error && <p className="pending-result">{error}</p>}

      <button className="btn btn--stamp btn--sm" type="submit" disabled={create.isPending}>
        {create.isPending ? 'Сохраняем…' : 'В каталог'}
      </button>
    </form>
  );
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

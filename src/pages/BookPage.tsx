import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookPatch, ReadingStatus } from '@shared/schema';
import { api, type Book } from '@/lib/api';
import { Cover } from '@/components/Cover';
import { OrganizationEditor } from '@/components/OrganizationEditor';
import { Icons, LentStamp, Progress, Stamp, shortDate } from '@/components/ui';

const STATUSES: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'none', label: 'Не начата' },
  { value: 'queued', label: 'В очередь' },
  { value: 'reading', label: 'Читаю' },
  { value: 'read', label: 'Прочитана' },
  { value: 'abandoned', label: 'Бросил' },
];

export function BookPage() {
  const { id } = useParams();
  const bookId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: book, isLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.book(bookId),
    enabled: Number.isFinite(bookId),
  });

  const patch = useMutation({
    mutationFn: (p: BookPatch) => api.update(bookId, p),
    // Правки статуса и прогресса — самое частое действие; ждать сеть незачем.
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: ['book', bookId] });
      const prev = qc.getQueryData<Book>(['book', bookId]);
      if (prev) qc.setQueryData<Book>(['book', bookId], { ...prev, ...p } as Book);
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['book', bookId], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['book', bookId] });
      void qc.invalidateQueries({ queryKey: ['books'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.remove(bookId),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/', { replace: true });
    },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) return <div className="page" style={{ padding: 24 }}>Открываем карточку…</div>;
  if (!book) return <div className="page" style={{ padding: 24 }}>Такой книги в каталоге нет.</div>;

  return (
    <>
      <header className="app-bar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Назад">
          {Icons.back}
        </button>
        <div className="label-mono" style={{ margin: 0 }}>{book.shelfmark}</div>
        <button className="icon-btn" onClick={() => setConfirmDelete((v) => !v)} aria-label="Удалить">
          {Icons.trash}
        </button>
      </header>

      <main className="page">
        <div className="book-hero">
          <Cover title={book.title} authors={book.authors} src={book.coverUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="bt">{book.title}</h1>
            <div className="ba">{book.authors || 'Автор не указан'}</div>
            <div style={{ marginTop: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Stamp status={book.status} date={book.finishedAt} />
              <LentStamp to={book.lentTo} />
            </div>
          </div>
        </div>

        <div style={{ padding: '0 16px 40px' }}>
          <OrganizationEditor key={book.id} book={book} />
          {confirmDelete && (
            <div className="ledger" style={{ borderColor: 'var(--stamp)' }}>
              <h3 style={{ color: 'var(--stamp)' }}>Убрать из каталога?</h3>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink-soft)', marginBottom: 12 }}>
                Запись, заметки и отметки о чтении исчезнут. Сама книга, разумеется, останется на полке.
              </p>
              <div style={{ display: 'flex', gap: 9 }}>
                <button className="btn btn--danger btn--sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  Убрать
                </button>
                <button className="btn btn--quiet btn--sm" onClick={() => setConfirmDelete(false)}>
                  Оставить
                </button>
              </div>
            </div>
          )}

          {/* ─────────────── Чтение: то, что меняется чаще всего ─────────── */}
          <div className="ledger">
            <h3>Чтение</h3>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  className="facet"
                  data-on={book.status === s.value ? '' : undefined}
                  onClick={() => patch.mutate({ status: s.value })}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {(book.status === 'reading' || book.progress) && (
              <div style={{ marginBottom: 14 }}>
                <Progress
                  value={book.progress ?? 0}
                  total={book.pages}
                  right={book.startedAt ? `с ${shortDate(book.startedAt)}` : undefined}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    defaultValue={book.progress ?? ''}
                    placeholder="страница"
                    style={{ width: 120 }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      const n = v === '' ? null : Number(v);
                      if (n !== book.progress) patch.mutate({ progress: n });
                    }}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)' }}>
                    {book.pages ? `из ${book.pages}` : 'страниц не знаем'}
                  </span>
                </div>
              </div>
            )}

            <textarea
              className="input"
              defaultValue={book.note ?? ''}
              placeholder="Заметка: о чём книга, кому дать почитать, что вспомнить через год"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== book.note) patch.mutate({ note: v });
              }}
            />
          </div>

          {/* ─────────────────────── Экземпляр ───────────────────────────── */}
          <div className="ledger">
            <h3>Экземпляр</h3>
            <div className="field">
              <label htmlFor="lent">У кого сейчас</label>
              <input
                id="lent"
                className="input"
                defaultValue={book.lentTo ?? ''}
                placeholder="дома"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== book.lentTo) {
                    // Дату записываем сами: человек вписывает имя, а не ведёт журнал.
                    patch.mutate({ lentTo: v, lentAt: v ? new Date().toISOString() : null });
                  }
                }}
              />
              {book.lentTo && book.lentAt && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 6 }}>
                  отдана {shortDate(book.lentAt)}
                </p>
              )}
            </div>
          </div>

          {/* ──────────────────────── Издание ────────────────────────────── */}
          <div className="ledger">
            <h3>Издание</h3>
            <dl>
              {book.publisher && (<><dt>Издательство</dt><dd>{book.publisher}</dd></>)}
              {book.year && (<><dt>Год</dt><dd>{book.year}</dd></>)}
              {book.pages && (<><dt>Страниц</dt><dd>{book.pages}</dd></>)}
              {book.binding && (<><dt>Переплёт</dt><dd>{book.binding}</dd></>)}
              {book.genre && (<><dt>Жанр</dt><dd>{book.genre}</dd></>)}
              {book.isbn && (<><dt>ISBN</dt><dd className="mono">{book.isbn}</dd></>)}
            </dl>
          </div>

          {book.annotation && (
            <div className="ledger">
              <h3>О книге</h3>
              <p className="note" style={{ fontStyle: 'normal' }}>{book.annotation}</p>
            </div>
          )}

          {book.source && <SourceCredits raw={book.source} />}
        </div>
      </main>
    </>
  );
}

/**
 * Откуда приехало какое поле. Данные о русских книгах собираются из пяти мест
 * разного качества — видеть источник полезно, когда что-то выглядит странно.
 */
function SourceCredits({ raw }: { raw: string }) {
  let map: Record<string, string>;
  try {
    map = JSON.parse(raw);
  } catch {
    return null;
  }
  const NAMES: Record<string, string> = {
    livelib: 'LiveLib',
    k10plus: 'K10plus',
    google: 'Google Books',
    openlibrary: 'OpenLibrary',
    loc: 'Library of Congress',
  };
  const by = new Map<string, string[]>();
  const FIELD: Record<string, string> = {
    title: 'название', authors: 'автор', publisher: 'издательство', year: 'год',
    pages: 'страницы', binding: 'переплёт', genre: 'жанр', annotation: 'аннотация', coverUrl: 'обложка',
  };
  for (const [field, src] of Object.entries(map)) {
    const label = FIELD[field] ?? field;
    by.set(src, [...(by.get(src) ?? []), label]);
  }
  if (!by.size) return null;

  return (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 16, lineHeight: 1.8, letterSpacing: '.04em' }}>
      {[...by.entries()].map(([src, fields]) => (
        <span key={src} style={{ display: 'block' }}>
          {NAMES[src] ?? src} → {fields.join(', ')}
        </span>
      ))}
    </p>
  );
}

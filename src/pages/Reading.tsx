import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Book } from '@/lib/api';
import { Cover } from '@/components/Cover';
import { Empty, LentStamp, Progress, shortDate } from '@/components/ui';
import { ExternalReadingForm } from '@/components/ExternalReadingForm';
import type { ExternalReading } from '@shared/external-reading';

export function Reading() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['queue'], queryFn: api.queue });
  const [editing, setEditing] = useState<ExternalReading | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const done = [
    ...(data?.done ?? []).map(book => ({ ...book, kind: 'library' as const })),
    ...(data?.externalDone ?? []).map(book => ({ ...book, coverUrl: null, kind: 'external' as const })),
  ].sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') || b.id - a.id);
  const years = [...new Set(done.flatMap(b => b.finishedAt ? [b.finishedAt.slice(0, 4)] : []))].sort().reverse();
  const shown = done.filter(b => (!year || b.finishedAt?.startsWith(year))
    && `${b.title} ${b.authors}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));

  // Локальная копия очереди: перетаскивание должно откликаться мгновенно,
  // сервер узнаёт о новом порядке после того, как палец отпустили.
  const [order, setOrder] = useState<Book[]>([]);
  useEffect(() => {
    if (data?.queue) setOrder(data.queue);
  }, [data?.queue]);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorder(ids),
    onSettled: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  });

  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const drop = (targetId: number) => {
    if (dragId === null || dragId === targetId) return;
    const from = order.findIndex((b) => b.id === dragId);
    const to = order.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrder(next);
    reorder.mutate(next.map((b) => b.id));
  };

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  return (
    <>
      <header className="app-bar">
        <div>
          <div className="title">Список чтения</div>
          <div className="sub">
            {data
              ? `${data.now.length} в работе · ${order.length} в очереди · ${stats.data?.readThisYear ?? 0} за год`
              : ' '}
          </div>
        </div>
      </header>

      <main className="page">
        <div className="reading-actions reading-toolbar">
          <button className="btn btn--primary" onClick={() => setEditing(null)}>Добавить прочитанную</button>
          <button className="btn btn--ghost" onClick={() => navigate('/')}>Выбрать из библиотеки</button>
        </div>
        {editing !== undefined && <ExternalReadingForm key={editing?.id ?? 'new'} entry={editing} onClose={() => setEditing(undefined)} />}
        <div className="drawer reading-board">
          {isLoading && <p style={{ padding: '24px 0', color: 'var(--ink-soft)' }}>Достаём из ящика…</p>}
          {error && <Empty title="Не удалось загрузить список">{error.message}<button className="btn btn--quiet" onClick={() => refetch()}>Повторить</button></Empty>}
          {reorder.isError && <p role="alert">Не удалось сохранить порядок. Попробуйте ещё раз.</p>}

          {data && data.now.length === 0 && order.length === 0 && done.length === 0 && (
            <Empty title="Список пуст">
              Откройте книгу в каталоге и поставьте «Читаю» или «В очередь». Прочитанные книги вне библиотеки добавляйте кнопкой «Добавить прочитанную».
            </Empty>
          )}

          {data && data.now.length > 0 && (
            <section className="reading-section">
              <div className="drawer-tab">
                <span>Сейчас читаю</span>
                <hr />
              </div>
              {data.now.map((b) => (
                <button key={b.id} className="now" onClick={() => navigate(`/book/${b.id}`)}>
                  <Cover title={b.title} authors={b.authors} src={b.coverUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bt">{b.title}</div>
                    <div className="ba">{b.authors}</div>
                    <div style={{ marginTop: 11 }}>
                      <Progress
                        value={b.progress ?? 0}
                        total={b.pages}
                        right={b.startedAt ? `с ${shortDate(b.startedAt)}` : undefined}
                      />
                    </div>
                  </div>
                </button>
              ))}
            </section>
          )}

          {order.length > 0 && (
            <section className="reading-section">
              <div className="drawer-tab">
                <span>Дальше · порядок можно менять</span>
                <hr />
              </div>
              {order.map((b, i) => (
                <div
                  key={b.id}
                  className="q-item"
                  draggable
                  data-dragging={dragId === b.id ? '' : undefined}
                  data-over={overId === b.id && dragId !== b.id ? '' : undefined}
                  onDragStart={() => setDragId(b.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverId(b.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(b.id);
                    setOverId(null);
                  }}
                >
                  <span className="n">{i + 1}</span>
                  <Cover title={b.title} authors={b.authors} src={b.coverUrl} />
                  <button
                    style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
                    onClick={() => navigate(`/book/${b.id}`)}
                  >
                    <div className="bt">{b.title}</div>
                    <div className="ba">{b.authors}</div>
                    {b.lentTo && (
                      <div style={{ marginTop: 4 }}>
                        <LentStamp to={b.lentTo} mini />
                      </div>
                    )}
                  </button>
                  <span className="grab" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ))}
            </section>
          )}

          {data && done.length > 0 && (
            <section className="reading-section reading-history">
              <div className="drawer-tab">
                <span>Прочитано · {done.length}</span>
                <hr />
              </div>
              <div className="reading-filters">
                <input className="input" type="search" aria-label="Поиск в прочитанном" placeholder="Название или автор…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" aria-label="Год прочтения" value={year} onChange={e => setYear(e.target.value)}><option value="">Все годы</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
              </div>
              {!shown.length && <Empty title="Ничего не найдено"><button className="btn btn--quiet" onClick={() => { setYear(''); setSearch(''); }}>Сбросить фильтры</button></Empty>}
              {shown.map((b) => (
                <button key={`${b.kind}-${b.id}`} className="q-item" onClick={() => b.kind === 'external' ? setEditing(b) : navigate(`/book/${b.id}`)}>
                  <span className="n" style={{ color: 'var(--stamp)' }}>✓</span>
                  <Cover title={b.title} authors={b.authors} src={b.coverUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bt">{b.title}</div>
                    <div className="ba">
                      {b.authors}
                      {b.finishedAt && ` · ${shortDate(b.kind === 'external' ? `${b.finishedAt}T12:00:00` : b.finishedAt)}`}
                    </div>
                    {b.kind === 'external' && <div className="reading-external-label">Вне библиотеки · изменить</div>}
                    {b.note && <div className="reading-note">{b.note}</div>}
                  </div>
                </button>
              ))}
            </section>
          )}
        </div>
      </main>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Book } from '@/lib/api';
import { Cover } from '@/components/Cover';
import { Empty, LentStamp, Progress, shortDate } from '@/components/ui';
import { ExternalReadingForm } from '@/components/ExternalReadingForm';
import type { ExternalReading } from '@shared/external-reading';
import '@/styles/reading.css';

function ReadingEditor({ entry, onClose }: { entry: ExternalReading | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="reading-dialog" aria-label={entry ? 'Изменить запись' : 'Добавить прочитанную книгу'} onCancel={onClose}>
    <button type="button" className="reading-dialog-close" aria-label="Закрыть" onClick={onClose}>×</button>
    <ExternalReadingForm entry={entry} onClose={onClose} />
  </dialog>;
}

export function Reading() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['queue'], queryFn: api.queue });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const [editing, setEditing] = useState<ExternalReading | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const done = [
    ...(data?.done ?? []).map(book => ({ ...book, kind: 'library' as const })),
    ...(data?.externalDone ?? []).map(book => ({ ...book, kind: 'external' as const })),
  ].sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '') || b.id - a.id);
  const years = [...new Set(done.flatMap(b => b.finishedAt ? [b.finishedAt.slice(0, 4)] : []))].sort().reverse();
  const shown = done.filter(b => (!year || b.finishedAt?.startsWith(year))
    && `${b.title} ${b.authors} ${b.isbn ?? ''}`.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  const [order, setOrder] = useState<Book[]>([]);
  useEffect(() => { if (data?.queue) setOrder(data.queue); }, [data?.queue]);
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.reorder(ids),
    onSettled: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (reorder.isPending || from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setOrder(next);
    reorder.mutate(next.map(b => b.id));
  };

  return <>
    <header className="app-bar reading-header">
      <div><div className="title">Список чтения</div><div className="sub">{data ? `${data.now.length} читаю · ${order.length} в очереди · ${stats.data?.readThisYear ?? 0} прочитано за год` : 'Моя книжная коллекция'}</div></div>
    </header>
    <main className="page reading-page">
      <div className="reading-toolbar">
        <div className="reading-actions">
          <button className="btn btn--primary" onClick={() => setEditing(null)}>+ Добавить прочитанную</button>
          <button className="btn btn--ghost" onClick={() => navigate('/')}>Добавить из библиотеки</button>
        </div>
        <p className="reading-toolbar-hint">Истории, в которые хочется возвращаться.</p>
      </div>
      <div className="reading-board">
        {isLoading && <p role="status">Собираем книжные полки…</p>}
        {error && <Empty title="Не удалось загрузить список">{error.message}<button className="btn btn--quiet" onClick={() => refetch()}>Повторить</button></Empty>}
        {reorder.isError && <p role="alert">Не удалось сохранить порядок. Попробуйте ещё раз.</p>}
        {data && !data.now.length && !order.length && !done.length && <Empty title="Ваша следующая история — здесь">Откройте книгу в каталоге и нажмите «Читаю» или «Добавить в очередь». Книгу вне библиотеки можно добавить сразу в прочитанное.</Empty>}

        {!!data?.now.length && <section className="reading-section" aria-labelledby="reading-now">
          <div className="reading-section-heading"><h2 id="reading-now">Сейчас читаю <span>{data.now.length}</span></h2><p>Продолжить с того же места</p></div>
          <div className="reading-shelf">
            {data.now.map(b => <button key={b.id} className="reading-card" onClick={() => navigate(`/book/${b.id}`)}>
              <div className="reading-art"><Cover title={b.title} authors={b.authors} src={b.coverUrl} /><span className="reading-badge">Читаю</span></div>
              <div className="reading-card-info"><h3>{b.title}</h3><p className="reading-author">{b.authors}</p><Progress value={b.progress ?? 0} total={b.pages} right={b.startedAt ? `с ${shortDate(b.startedAt)}` : undefined} /></div>
            </button>)}
          </div>
        </section>}

        {!!order.length && <section className="reading-section" aria-labelledby="reading-next">
          <div className="reading-section-heading"><h2 id="reading-next">На очереди <span>{order.length}</span></h2><p>Меняйте порядок стрелками или перетаскиванием</p></div>
          <div className="reading-shelf">
            {order.map((b, i) => <article key={b.id} className="reading-queue-card" draggable={!reorder.isPending}
              data-dragging={dragId === b.id ? '' : undefined} data-over={overId === b.id && dragId !== b.id ? '' : undefined}
              onDragStart={e => { e.dataTransfer.setData('text/plain', String(b.id)); setDragId(b.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={e => { e.preventDefault(); setOverId(b.id); }}
              onDrop={e => { e.preventDefault(); move(order.findIndex(book => book.id === dragId), i); setDragId(null); setOverId(null); }}>
              <button className="reading-card" onClick={() => navigate(`/book/${b.id}`)}>
                <div className="reading-art"><Cover title={b.title} authors={b.authors} src={b.coverUrl} /><span className="reading-badge">{String(i + 1).padStart(2, '0')} · в очереди</span></div>
                <div className="reading-card-info"><h3>{b.title}</h3><p className="reading-author">{b.authors}</p>{b.lentTo && <LentStamp to={b.lentTo} mini />}</div>
              </button>
              <div className="reading-order"><button aria-label={`Раньше в очереди: ${b.title}`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, i - 1)}>← Раньше</button><button aria-label={`Позже в очереди: ${b.title}`} disabled={i === order.length - 1 || reorder.isPending} onClick={() => move(i, i + 1)}>Позже →</button></div>
            </article>)}
          </div>
        </section>}

        {!!done.length && <section className="reading-section reading-history" aria-labelledby="reading-done">
          <div className="reading-section-heading"><h2 id="reading-done">Прочитано <span>{done.length}</span></h2><p>Все ваши истории на одной полке</p></div>
          <div className="reading-filters">
            <input className="input" type="search" aria-label="Поиск в прочитанном" placeholder="Найти по названию, автору или ISBN" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input" aria-label="Год прочтения" value={year} onChange={e => setYear(e.target.value)}><option value="">Все годы</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
          </div>
          {(search || year) && <p className="reading-result-count" role="status">Найдено: {shown.length}</p>}
          {!shown.length && <Empty title="Ничего не найдено"><button className="btn btn--quiet" onClick={() => { setYear(''); setSearch(''); }}>Сбросить фильтры</button></Empty>}
          <div className="reading-grid">
            {shown.map(b => <button key={`${b.kind}-${b.id}`} className="reading-card" onClick={() => b.kind === 'external' ? setEditing(b) : navigate(`/book/${b.id}`)}>
              <div className="reading-art"><Cover title={b.title} authors={b.authors} src={b.coverUrl} /><span className="reading-badge reading-badge--done">✓ Прочитано{b.finishedAt ? ` · ${shortDate(b.finishedAt.slice(0, 10) + 'T12:00:00')}` : ''}</span></div>
              <div className="reading-card-info"><h3>{b.title}</h3><p className="reading-author">{b.authors}</p><p className="reading-card-action">{b.kind === 'external' ? 'Вне библиотеки · изменить' : 'Открыть книгу ↗'}</p>{b.note && <p className="reading-note">{b.note}</p>}</div>
            </button>)}
          </div>
        </section>}
      </div>
    </main>
    {editing !== undefined && <ReadingEditor key={editing?.id ?? 'new'} entry={editing} onClose={() => setEditing(undefined)} />}
  </>;
}

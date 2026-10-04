import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Book } from '@/lib/api';
import { Cover } from '@/components/Cover';
import { Empty, LentStamp, Progress, shortDate } from '@/components/ui';

export function Reading() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({ queryKey: ['queue'], queryFn: api.queue });

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
        <div className="drawer reading-board">
          {isLoading && <p style={{ padding: '24px 0', color: 'var(--ink-soft)' }}>Достаём из ящика…</p>}

          {data && data.now.length === 0 && order.length === 0 && data.done.length === 0 && (
            <Empty title="Список пуст">
              Откройте книгу в каталоге и поставьте «Читаю» или «В очередь» — она появится здесь.
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

          {data && data.done.length > 0 && (
            <section className="reading-section">
              <div className="drawer-tab">
                <span>Прочитано</span>
                <hr />
              </div>
              {data.done.map((b) => (
                <button key={b.id} className="q-item" onClick={() => navigate(`/book/${b.id}`)}>
                  <span className="n" style={{ color: 'var(--stamp)' }}>✓</span>
                  <Cover title={b.title} authors={b.authors} src={b.coverUrl} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bt">{b.title}</div>
                    <div className="ba">
                      {b.authors}
                      {b.finishedAt && ` · ${shortDate(b.finishedAt)}`}
                    </div>
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

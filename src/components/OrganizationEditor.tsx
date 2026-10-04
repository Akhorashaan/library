import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Book } from '@/lib/api';

export function OrganizationEditor({ book }: { book: Book }) {
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const [series, setSeries] = useState(book.series ?? '');
  const [start, setStart] = useState(book.seriesOrder?.toString() ?? '');
  const [end, setEnd] = useState(book.seriesEnd?.toString() ?? '');
  const [part, setPart] = useState(book.seriesPart?.toString() ?? '');
  const [tags, setTags] = useState((book.tags ?? []).join(', '));
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.update(book.id, {
      series: series.trim() || null,
      seriesOrder: series.trim() && start ? Number(start) : null,
      seriesEnd: series.trim() && end ? Number(end) : null,
      seriesPart: series.trim() && part ? Number(part) : null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }),
    onSuccess: async (updated) => {
      setSeries(updated.series ?? '');
      setStart(updated.seriesOrder?.toString() ?? '');
      setEnd(updated.seriesEnd?.toString() ?? '');
      setPart(updated.seriesPart?.toString() ?? '');
      setTags(updated.tags.join(', '));
      setSaved(true);
      await Promise.all(['book', 'books', 'stats', 'queue', 'series'].map((key) => qc.invalidateQueries({ queryKey: [key] })));
    },
  });
  return <form className="ledger" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} onChange={() => setSaved(false)}>
    <h3>Серия и теги</h3>
    <div className="field"><label htmlFor="book-series">Серия / цикл</label>
      <input id="book-series" className="input" list="series-suggestions" value={series} maxLength={160} placeholder="Вне серии" onChange={(e) => setSeries(e.target.value)} />
      <datalist id="series-suggestions">{stats.data?.series?.map((s) => <option key={s.value} value={s.value} />)}</datalist>
    </div>
    <div className="organization-numbers">
      <div className="field"><label htmlFor="series-start">Номер книги</label><input id="series-start" className="input" type="number" min="1" step="1" disabled={!series.trim()} value={start} onChange={(e) => setStart(e.target.value)} placeholder="Неизвестен" /></div>
      <div className="field"><label htmlFor="series-end">По номер (сборник)</label><input id="series-end" className="input" type="number" min={start || 1} step="1" disabled={!series.trim()} value={end} onChange={(e) => setEnd(e.target.value)} placeholder="Одна книга" /></div>
    </div>
    <div className="field"><label htmlFor="series-part">Часть книги (если издана в нескольких томах)</label><input id="series-part" className="input" type="number" min="1" max="1000" step="1" disabled={!series.trim()} value={part} onChange={(e) => setPart(e.target.value)} placeholder="Книга целиком" /></div>
    <div className="field"><label htmlFor="book-tags">Теги через запятую</label><input id="book-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="фэнтези, магия, приключения" /></div>
    <div className="tag-list" aria-label="Добавить существующий тег">
      {stats.data?.tags?.filter((t) => !tags.split(',').map((s) => s.trim().toLocaleLowerCase('ru')).includes(t.value)).slice(0, 12).map((t) => <button type="button" className="filter-pill" key={t.value} onClick={() => { setTags(tags.trim() ? `${tags}, ${t.value}` : t.value); setSaved(false); }}>+ {t.value}</button>)}
    </div>
    <button className="btn btn--sm" type="submit" disabled={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить серию и теги'}</button>
    {saved && <p role="status">Сохранено</p>}
    {save.isError && <p role="alert">{save.error.message}</p>}
  </form>;
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Empty, Icons } from '@/components/ui';
import { SERIES_STATUS, seriesReference, volumeKey, type SeriesEntry, type SeriesPreference, type SeriesReference, type SeriesStatus, type SeriesSummary } from '@shared/series';

const SCOPES = { following: 'Слежу', ignored: 'Не слежу', all: 'Все серии' } as const;
type Scope = keyof typeof SCOPES;
const PRIORITY: Record<SeriesStatus, number> = { missing: 0, current: 1, complete: 2, untranslated: 3, unknown: 4 };

export function Series() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [query, setQuery] = useState(params.get('name') ?? '');
  const [scope, setScope] = useState<Scope>(params.has('name') ? 'all' : 'following');
  const [filter, setFilter] = useState<SeriesStatus | 'all'>('all');
  const [notice, setNotice] = useState<SeriesPreference | null>(null);
  const data = useQuery({ queryKey: ['series'], queryFn: api.series });
  const follow = useMutation({
    mutationFn: api.followSeries,
    onSuccess: async (preference) => {
      qc.setQueryData<SeriesEntry[]>(['series'], previous => previous?.map(s => s.name === preference.name ? { ...s, following: preference.following } : s));
      setNotice(preference);
      await qc.invalidateQueries({ queryKey: ['series'] });
    },
  });
  const entries = data.data ?? [];
  const following = entries.filter(s => s.following);
  const counts = { following: following.length, ignored: entries.length - following.length, all: entries.length };
  const scoped = entries.filter(s => scope === 'all' || s.following === (scope === 'following'));
  const searched = scoped.filter(s => s.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  const shown = searched.filter(s => filter === 'all' || s.status === filter)
    .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || a.name.localeCompare(b.name, 'ru'));
  return <>
    <header className="app-bar"><div><h1 className="title">Серии</h1><div className="sub">Что собрано и чего не хватает</div></div></header>
    <main className="page series-page">
      <div className="series-overview">
        <p className="series-intro">Собирайте то, что хочется продолжать.<span>Полнота — по вышедшим русским изданиям. Сборники учитываются по содержимому.</span></p>
        {data.isSuccess && <div className="series-totals" aria-label="Серии, за которыми слежу">
          <div><b>{following.length}</b><span>слежу</span></div>
          <div><b>{following.filter(s => s.status === 'missing').length}</b><span>не хватает</span></div>
          <div><b>{following.filter(s => s.status === 'complete' || s.status === 'current').length}</b><span>всё на полке</span></div>
        </div>}
      </div>
      <div className="series-toolbar">
        <div className="series-scopes" aria-label="Отслеживание серий">{(Object.keys(SCOPES) as Scope[]).map(k => <button key={k} aria-pressed={scope === k} data-on={scope === k ? '' : undefined} onClick={() => { setScope(k); setFilter('all'); }}>{SCOPES[k]} <b>{counts[k]}</b></button>)}</div>
        <div className="search">{Icons.search}<input aria-label="Найти серию" type="search" placeholder="Название серии…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Очистить поиск" onClick={() => setQuery('')}>{Icons.close}</button>}</div>
      </div>
      {notice && <div className="series-notice" role="status"><span>«{notice.name}»: {notice.following ? 'снова слежу' : 'перенесена в «Не слежу»'}.</span><button disabled={follow.isPending} onClick={() => follow.mutate({ name: notice.name, following: !notice.following })}>Отменить</button><button aria-label="Скрыть уведомление" onClick={() => setNotice(null)}>×</button></div>}
      {follow.isError && <p className="series-error" role="alert">Не удалось сохранить: {follow.error.message}. Попробуйте ещё раз.</p>}
      <div className="series-workspace">
        <aside className="series-sidebar">
          <h2 className="label-mono">Полнота серии</h2>
          <select className="input series-status-select" aria-label="Полнота серии" value={filter} onChange={e => setFilter(e.target.value as SeriesStatus | 'all')}>
            {(['all', 'missing', 'complete', 'current', 'untranslated', 'unknown'] as const).map(k => <option key={k} value={k}>{k === 'all' ? 'Любая полнота' : SERIES_STATUS[k]} · {k === 'all' ? searched.length : searched.filter(s => s.status === k).length}</option>)}
          </select>
          <div className="series-filters" aria-label="Полнота серии">
            {(['all', 'missing', 'complete', 'current', 'untranslated', 'unknown'] as const).map(k => <button key={k} className="facet" data-on={filter === k ? '' : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'Любая' : SERIES_STATUS[k]} <b>{k === 'all' ? searched.length : searched.filter(s => s.status === k).length}</b></button>)}
          </div>
          <p className="series-sidebar-note">Не хочется продолжать? Нажмите «Не следить» в карточке. Серия останется в библиотеке, и к ней можно будет вернуться.</p>
        </aside>
        <section className="series-results" aria-label="Список серий" aria-busy={data.isLoading}>
          <div className="series-results-label">{SCOPES[scope]} <span>· {shown.length}</span></div>
          {data.isLoading && <p role="status">Сверяем серии с каталогом…</p>}
          {data.isError && <Empty title="Не удалось загрузить серии">{data.error.message}<button className="btn btn--sm" onClick={() => data.refetch()}>Повторить</button></Empty>}
          {data.isSuccess && !shown.length && <Empty title={entries.length ? scope === 'ignored' && !query && filter === 'all' ? 'Здесь будут серии, за которыми вы не следите' : 'Таких серий нет' : 'Серии ещё не указаны'}>{entries.length ? <button className="btn btn--quiet btn--sm" onClick={() => { setQuery(''); setFilter('all'); setScope('all'); }}>Показать все серии</button> : 'Укажите серию и номер книги в её карточке.'}</Empty>}
          <div className="series-grid">{shown.map(s => <SeriesCard key={s.name} series={s} initiallyOpen={params.get('name') === s.name} onFollow={() => follow.mutate({ name: s.name, following: !s.following })} saving={follow.isPending} />)}</div>
        </section>
      </div>
    </main>
  </>;
}

function SeriesCard({ series: s, initiallyOpen, onFollow, saving }: { series: SeriesEntry; initiallyOpen: boolean; onFollow: () => void; saving: boolean }) {
  const [editing, setEditing] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const uncertain = s.status === 'unknown';
  return <article className="series-card" aria-label={s.name} data-following={s.following}>
    <div className="series-heading"><span className="series-status" data-status={s.status}>{SERIES_STATUS[s.status]}</span>{!s.following && <span className="series-ignored">Не слежу</span>}</div>
    <h2>{s.name}</h2>
    <p className="series-count">{s.total != null ? <><strong>{s.owned}<span> / {s.total}</span></strong> книг{s.volumes.some(v => v.part != null) ? ' / частей' : ''} на полке</> : `${s.books.length} изданий в библиотеке`}</p>
    {s.total != null && <progress className="series-progress" value={s.owned} max={s.total} aria-label={`Собрано ${s.owned} из ${s.total}`} />}
    {s.missing.length > 0 && <div className="series-missing"><h3>{uncertain ? 'Пока не сопоставлены' : 'Не хватает'} · {s.missing.length}</h3><ul>{(showMissing ? s.missing : s.missing.slice(0, 3)).map(v => <li key={v.key}><span className="series-number">{v.key}</span><span>{v.title}</span></li>)}</ul>{s.missing.length > 3 && <button className="series-more" aria-expanded={showMissing} onClick={() => setShowMissing(!showMissing)}>{showMissing ? 'Свернуть список' : `Ещё ${s.missing.length - 3} · показать все`}</button>}</div>}
    {s.status === 'current' && <p className="series-hint">Всё вышедшее на дату проверки собрано. Возможны новые книги или переводы.</p>}
    {uncertain && <p className="series-hint">Нужно уточнить состав или сопоставить издания, чтобы подтвердить полноту.</p>}
    {s.status === 'untranslated' && <p className="series-hint">Русское издание не найдено при проверке. Подробности — в составе серии.</p>}
    <details className="series-details" open={initiallyOpen || undefined}><summary>Книги на полке и состав серии</summary>
      {s.reference?.note && <p className="series-hint">{s.reference.note}</p>}
      {s.gaps.length > 0 && <p className="series-hint">Пробелы в нумерации: {s.gaps.join(', ')}. Проверьте содержимое сборников и книги без номера.</p>}
      {s.volumes.length > 0 && <ol className="series-volumes">{s.volumes.map(v => <li key={v.key} data-owned={v.bookIds.length ? '' : undefined}><span aria-hidden="true">{v.bookIds.length ? '✓' : '○'}</span><span><b>{v.key}.</b> {v.title}<small>{v.bookIds.length ? 'Есть в библиотеке' : 'Нет сопоставленного издания'}</small></span></li>)}</ol>}
      <h3>Ваши издания</h3><ul className="series-owned">{s.books.map(b => <li key={b.id}><Link to={`/book/${b.id}`}>{b.title} →</Link>{s.unplaced.some(u => u.id === b.id) && s.reference?.volumes.length ? <small>Нужно сопоставить с составом серии</small> : null}</li>)}</ul>
      {s.reference && s.reference.sources.length > 0 && <div className="series-sources">{s.reference.sources.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">Источник {i + 1} ↗</a>)}</div>}
      <button className="btn btn--quiet btn--sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Закрыть редактор' : 'Уточнить состав'}</button>
      {editing && <ReferenceEditor key={JSON.stringify(s.reference)} series={s} onSaved={() => setEditing(false)} />}
    </details>
    <div className="series-card-footer">
      <span className="series-checked">{s.reference?.checkedAt ? `Проверено ${s.reference.checkedAt.split('-').reverse().join('.')}` : 'Состав не проверен'}</span>
      <button className="series-follow" disabled={saving} onClick={onFollow}>{s.following ? 'Не следить' : 'Следить снова'}</button>
    </div>
  </article>;
}

function ReferenceEditor({ series: s, onSaved }: { series: SeriesSummary; onSaved: () => void }) {
  const qc = useQueryClient();
  const [publication, setPublication] = useState<SeriesReference['publication']>(s.reference?.publication ?? 'unknown');
  const [text, setText] = useState(s.reference?.volumes.map(v => `${volumeKey(v)} | ${v.title}`).join('\n') ?? '');
  const [sources, setSources] = useState(s.reference?.sources.join('\n') ?? '');
  const [note, setNote] = useState(s.reference?.note ?? '');
  const [checked, setChecked] = useState(s.reference?.checkedAt ?? new Date().toISOString().slice(0, 10));
  const [coverage, setCoverage] = useState<Record<string, string>>(Object.fromEntries(Object.entries(s.reference?.coverage ?? {}).map(([isbn, keys]) => [isbn, keys.join(', ')])));
  const save = useMutation({
    mutationFn: async () => {
      const volumes = text.split('\n').filter(l => l.trim()).map(line => {
        const match = line.match(/^\s*(\d+)(?:\.(\d+))?\s*\|\s*(.+?)\s*$/);
        if (!match) throw new Error('Каждая строка: номер | название. Для части: 12.1 | название.');
        return { number: Number(match[1]), part: match[2] ? Number(match[2]) : null, title: match[3]! };
      });
      const contents = Object.fromEntries(Object.entries(coverage).filter(([, value]) => value.trim()).map(([isbn, value]) => [isbn, [...new Set(value.split(',').map(v => v.trim()).filter(Boolean))]]));
      const result = seriesReference.safeParse({ name: s.name, publication, volumes, sources: sources.split('\n').map(v => v.trim()).filter(Boolean), checkedAt: checked || null, note, coverage: contents });
      if (!result.success) throw new Error(result.error.issues.map(i => i.message).join('; '));
      return api.saveSeries(result.data);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['series'] }); onSaved(); },
  });
  return <form className="series-editor" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <label className="field">Выход книг на русском<select className="input" value={publication} onChange={e => setPublication(e.target.value as SeriesReference['publication'])}><option value="untranslated">Русское издание не найдено при проверке</option><option value="unknown">Состав ещё не проверен</option><option value="ongoing">Могут выходить новые книги или переводы</option><option value="finished">Серия завершена и переведена полностью</option></select></label>
    <label className="field">Вышедшие книги — по одной в строке<textarea className="input" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder={'1 | Название первой книги\n2 | Название второй книги'} /></label>
    <p className="series-hint">Для отдельных частей: 12.1 | Вороново сердце. Часть 1. Номера должны совпадать с карточками книг. Анонсы сюда не включаем.</p>
    {s.books.some(b => b.isbn) && <details className="series-details"><summary>Какие книги входят в мои издания</summary><p className="series-hint">Заполняйте для сборников и иностранных изданий с другой нумерацией. Через запятую укажите номера из списка выше, например: 1, 2, 3. Пустое поле — использовать номер из карточки.</p>{s.books.filter(b => b.isbn).map(b => <label className="field" key={b.id}>{b.title}<input className="input" value={coverage[b.isbn!] ?? ''} onChange={e => setCoverage(prev => ({ ...prev, [b.isbn!]: e.target.value }))} placeholder="Например: 1, 2, 3" /></label>)}</details>}
    <label className="field">Ссылки на источники — по одной в строке<textarea className="input" value={sources} onChange={e => setSources(e.target.value)} placeholder="https://…" /></label>
    <label className="field">Дата проверки<input className="input" type="date" value={checked} onChange={e => setChecked(e.target.value)} /></label>
    <label className="field">Примечание<textarea className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
    {save.isError && <p role="alert">{save.error.message}</p>}
    <button className="btn btn--sm" disabled={save.isPending} type="submit">{save.isPending ? 'Сохраняем…' : 'Сохранить состав'}</button>
  </form>;
}

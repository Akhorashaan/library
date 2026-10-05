import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { externalReadingInput, type ExternalReading } from '@shared/external-reading';
import { isbnSchema } from '@shared/schema';
import { Cover } from './Cover';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ExternalReadingForm({ entry, onClose }: { entry: ExternalReading | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isbnInput = useRef<HTMLInputElement>(null);
  const [isbn, setIsbn] = useState(entry?.isbn ?? '');
  const [lookupEnabled, setLookupEnabled] = useState(false);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [lookupState, setLookupState] = useState<'idle' | 'waiting' | 'loading' | 'done' | 'error'>('idle');
  const [lookupMessage, setLookupMessage] = useState('');
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [authors, setAuthors] = useState(entry?.authors ?? '');
  const [coverUrl, setCoverUrl] = useState(entry?.coverUrl ?? '');
  const [finishedAt, setFinishedAt] = useState(entry ? entry.finishedAt ?? '' : today());
  const [note, setNote] = useState(entry?.note ?? '');
  const [validation, setValidation] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = useRef({ title, authors, coverUrl });
  fields.current = { title, authors, coverUrl };
  const autofilled = useRef({ title: '', authors: '', coverUrl: '' });
  useEffect(() => { isbnInput.current?.focus(); }, []);
  useEffect(() => {
    if (!lookupEnabled) return;
    const parsed = isbnSchema.safeParse(isbn);
    if (!isbn.trim() || !parsed.success) {
      setLookupState('idle');
      return;
    }
    const controller = new AbortController();
    lookupRequest.current = controller;
    setLookupState('waiting');
    const timer = window.setTimeout(async () => {
      const snapshot = { ...fields.current };
      setLookupState('loading');
      try {
        const result = await api.lookup(parsed.data, lookupAttempt > 0, controller.signal);
        if (controller.signal.aborted) return;
        // A slow lookup must not overwrite edits made while it was running.
        if (result.found) {
          if (fields.current.coverUrl === snapshot.coverUrl && result.coverUrl) {
            setCoverUrl(result.coverUrl);
            autofilled.current.coverUrl = result.coverUrl;
          }
          if (fields.current.title === snapshot.title && result.title) {
            setTitle(result.title);
            autofilled.current.title = result.title;
          }
          if (fields.current.authors === snapshot.authors && result.authors) {
            setAuthors(result.authors);
            autofilled.current.authors = result.authors;
          }
        }
        setLibraryId(result.alreadyInLibrary);
        setLookupMessage(result.found ? 'Данные найдены. Проверьте название и автора перед сохранением.' : 'По этому ISBN ничего не найдено. Заполните название и автора вручную или повторите поиск.');
        setLookupState('done');
      } catch (error) {
        if (controller.signal.aborted) return;
        setLookupMessage(error instanceof Error ? error.message : 'Не удалось найти книгу');
        setLookupState('error');
      }
    }, lookupAttempt > 0 ? 0 : 800);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isbn, lookupEnabled, lookupAttempt]);
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['queue'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
    ]);
    onClose();
  };
  const save = useMutation({
    mutationFn: api.createExternalReading,
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.createExternalReading>[0]) => api.updateExternalReading(entry!.id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => api.removeExternalReading(entry!.id), onSuccess: refresh });
  const busy = save.isPending || update.isPending || remove.isPending;
  const error = validation || save.error?.message || update.error?.message || remove.error?.message;

  return <form className="external-reading-form" aria-label={entry ? 'Изменить запись' : 'Прочитанная книга вне библиотеки'} onSubmit={event => {
    event.preventDefault();
    if (lookupState === 'waiting' || lookupState === 'loading' || busy) return;
    const parsed = externalReadingInput.safeParse({ isbn, title, authors, coverUrl: coverUrl.trim() || null, finishedAt: finishedAt || null, note });
    if (!parsed.success) { setValidation(parsed.error.issues[0]?.message ?? 'Проверьте поля'); return; }
    setValidation('');
    (entry ? update : save).mutate(parsed.data);
  }}>
    <h2>{entry ? 'Изменить запись' : 'Прочитанная книга вне библиотеки'}</h2>
    <p>Электронная, одолженная или прочитанная давно — сохраните её в истории чтения.</p>
    <fieldset disabled={busy}>
      <div className="field">
        <label htmlFor="reading-isbn">ISBN — поиск книги</label>
        <div className="reading-isbn-row">
          <input ref={isbnInput} id="reading-isbn" className="input" placeholder="978-5-…" maxLength={32} value={isbn} aria-describedby="reading-isbn-hint" onChange={e => {
            lookupRequest.current?.abort();
            setIsbn(e.target.value);
            setLookupEnabled(true);
            setLookupAttempt(0);
            setLookupState('idle');
            setLookupMessage('');
            setLibraryId(null);
            setValidation('');
            setTitle(current => current === autofilled.current.title ? '' : current);
            setAuthors(current => current === autofilled.current.authors ? '' : current);
            setCoverUrl(current => current === autofilled.current.coverUrl ? '' : current);
          }} onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); setLookupEnabled(true); setLookupAttempt(value => value + 1); }
          }} />
          <button className="btn btn--ghost" type="button" disabled={!isbnSchema.safeParse(isbn).success || lookupState === 'loading'} onClick={() => { setLookupEnabled(true); setLookupAttempt(value => value + 1); }}>Найти по ISBN</button>
        </div>
        <small id="reading-isbn-hint">Введите 10 или 13 знаков — поиск начнётся автоматически. ISBN необязателен.</small>
        <div className="reading-lookup-status" role={lookupState === 'error' ? 'alert' : 'status'}>
          {lookupState === 'waiting' || lookupState === 'loading' ? 'Ищем книгу по ISBN…' : lookupMessage}
          {libraryId && <div>Книга уже есть в библиотеке. <Link to={`/book/${libraryId}`}>Открыть её карточку</Link></div>}
        </div>
      </div>
      <div className="field"><label htmlFor="reading-title">Название *</label><input id="reading-title" className="input" required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="reading-authors">Автор</label><input id="reading-authors" className="input" maxLength={500} value={authors} onChange={e => setAuthors(e.target.value)} /></div>
      <div className="reading-cover-field">
        <Cover title={title || 'Обложка'} authors={authors} src={coverUrl} />
        <div className="field"><label htmlFor="reading-cover">Обложка</label><input id="reading-cover" className="input" placeholder="Ссылка на изображение" value={coverUrl} onChange={e => setCoverUrl(e.target.value)} /><small>Найдём вместе с ISBN. Можно вставить ссылку на другую обложку.</small></div>
      </div>
      <div className="field"><label htmlFor="reading-finished">Дата прочтения</label><input id="reading-finished" className="input" type="date" value={finishedAt} onChange={e => setFinishedAt(e.target.value)} /><small>Можно оставить пустой, если не помните.</small></div>
      <div className="field"><label htmlFor="reading-note">Заметка</label><textarea id="reading-note" className="input" maxLength={10000} value={note} onChange={e => setNote(e.target.value)} /></div>
      {error && <p className="series-error" role="alert">{error}</p>}
      <div className="reading-actions">
        <button className="btn btn--primary" type="submit" disabled={lookupState === 'waiting' || lookupState === 'loading'}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button className="btn btn--quiet" type="button" onClick={onClose}>Отмена</button>
        {entry && <button className="btn btn--danger btn--sm" type="button" onClick={() => setConfirmDelete(true)}>Удалить запись</button>}
      </div>
      {confirmDelete && <div className="reading-delete" role="alert"><p>Удалить «{entry?.title}» из истории чтения?</p><div className="reading-actions"><button type="button" className="btn btn--danger btn--sm" onClick={() => remove.mutate()}>Да, удалить</button><button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmDelete(false)}>Оставить</button></div></div>}
    </fieldset>
  </form>;
}

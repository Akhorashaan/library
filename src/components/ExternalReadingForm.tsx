import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { externalReadingInput, type ExternalReading } from '@shared/external-reading';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ExternalReadingForm({ entry, onClose }: { entry: ExternalReading | null; onClose: () => void }) {
  const qc = useQueryClient();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [authors, setAuthors] = useState(entry?.authors ?? '');
  const [finishedAt, setFinishedAt] = useState(entry ? entry.finishedAt ?? '' : today());
  const [note, setNote] = useState(entry?.note ?? '');
  const [validation, setValidation] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { titleInput.current?.focus(); }, []);
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
    const parsed = externalReadingInput.safeParse({ title, authors, finishedAt: finishedAt || null, note });
    if (!parsed.success) { setValidation(parsed.error.issues[0]?.message ?? 'Проверьте поля'); return; }
    setValidation('');
    (entry ? update : save).mutate(parsed.data);
  }}>
    <h2>{entry ? 'Изменить запись' : 'Прочитанная книга вне библиотеки'}</h2>
    <p>Электронная, одолженная или прочитанная давно — сохраните её в истории чтения.</p>
    <fieldset disabled={busy}>
      <div className="field"><label htmlFor="reading-title">Название *</label><input ref={titleInput} id="reading-title" className="input" required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="reading-authors">Автор</label><input id="reading-authors" className="input" maxLength={500} value={authors} onChange={e => setAuthors(e.target.value)} /></div>
      <div className="field"><label htmlFor="reading-finished">Дата прочтения</label><input id="reading-finished" className="input" type="date" value={finishedAt} onChange={e => setFinishedAt(e.target.value)} /><small>Можно оставить пустой, если не помните.</small></div>
      <div className="field"><label htmlFor="reading-note">Заметка</label><textarea id="reading-note" className="input" maxLength={10000} value={note} onChange={e => setNote(e.target.value)} /></div>
      {error && <p className="series-error" role="alert">{error}</p>}
      <div className="reading-actions">
        <button className="btn btn--primary" type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button className="btn btn--quiet" type="button" onClick={onClose}>Отмена</button>
        {entry && <button className="btn btn--danger btn--sm" type="button" onClick={() => setConfirmDelete(true)}>Удалить запись</button>}
      </div>
      {confirmDelete && <div className="reading-delete" role="alert"><p>Удалить «{entry?.title}» из истории чтения?</p><div className="reading-actions"><button type="button" className="btn btn--danger btn--sm" onClick={() => remove.mutate()}>Да, удалить</button><button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmDelete(false)}>Оставить</button></div></div>}
    </fieldset>
  </form>;
}

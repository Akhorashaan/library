import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import type { LookupResult } from '@shared/schema';
import { api } from '@/lib/api';
import { Cover } from '@/components/Cover';
import { Icons } from '@/components/ui';

/** На обложке печатают EAN-13 — это и есть ISBN-13. Остальное встречается на импорте. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a'] as const;

type Phase =
  | { kind: 'camera' }
  | { kind: 'manual' }
  | { kind: 'looking'; isbn: string }
  | { kind: 'found'; result: LookupResult }
  | { kind: 'error'; message: string };

export function Scan() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [manualIsbn, setManualIsbn] = useState('');
  const [saving, setSaving] = useState(false);

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const lookup = useCallback(
    async (isbn: string) => {
      stopCamera();
      setPhase({ kind: 'looking', isbn });
      // Короткая вибрация — подтверждение, что штрих-код взят. На десктопе молчит.
      navigator.vibrate?.(35);
      try {
        const result = await api.lookup(isbn);
        setPhase({ kind: 'found', result });
      } catch (e) {
        setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось найти книгу' });
      }
    },
    [stopCamera]
  );

  /* ─────────────────────────── живая камера ─────────────────────────── */

  useEffect(() => {
    if (phase.kind !== 'camera') return;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: [...FORMATS] });

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Задняя камера: штрих-код на обложке, а не на лице.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        let busy = false;
        const tick = async () => {
          if (cancelled) return;
          // Детектор медленнее кадров: пропускаем кадр, пока занят предыдущим.
          if (!busy && video.readyState >= 2) {
            busy = true;
            try {
              const codes = await detector.detect(video);
              const value = codes[0]?.rawValue?.replace(/\D/g, '');
              if (value && (value.length === 13 || value.length === 8 || value.length === 12)) {
                cancelled = true;
                void lookup(value);
                return;
              }
            } catch {
              /* отдельный сбойный кадр — не повод останавливать сканер */
            }
            busy = false;
          }
          loopRef.current = requestAnimationFrame(tick);
        };
        loopRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError');
        setPhase({
          kind: 'manual',
          ...(denied ? {} : {}),
        });
        setCameraNote(
          denied
            ? 'Доступ к камере закрыт. Введите ISBN руками или выберите фото.'
            : 'Камера недоступна на этом устройстве.'
        );
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [phase.kind, lookup, stopCamera]);

  const [cameraNote, setCameraNote] = useState<string | null>(null);

  useEffect(() => stopCamera, [stopCamera]);

  /* ──────────────────────────── фото из файла ───────────────────────── */

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    stopCamera();
    setPhase({ kind: 'looking', isbn: '' });
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: [...FORMATS] });
      const codes = await detector.detect(bitmap);
      bitmap.close();
      const value = codes[0]?.rawValue?.replace(/\D/g, '');
      if (!value) {
        setPhase({ kind: 'error', message: 'На фото не видно штрих-кода. Снимите ближе и ровнее.' });
        return;
      }
      await lookup(value);
    } catch {
      setPhase({ kind: 'error', message: 'Не удалось разобрать изображение' });
    }
  };

  /* ──────────────────────────── добавление ──────────────────────────── */

  const add = async () => {
    if (phase.kind !== 'found') return;
    const r = phase.result;
    setSaving(true);
    try {
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
      navigate(`/book/${book.id}`, { replace: true });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось сохранить' });
    } finally {
      setSaving(false);
    }
  };

  /* ────────────────────────────── разметка ──────────────────────────── */

  return (
    <div className="scanner">
      <div className="top">
        <button onClick={() => navigate(-1)}>Отмена</button>
        <span>Штрих-код</span>
        <span style={{ width: 52 }} />
      </div>

      <div className="viewport">
        {phase.kind === 'camera' && (
          <>
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="frame">
              <i />
              <i />
              <i />
              <i />
              <div className="beam" />
            </div>
          </>
        )}

        {phase.kind === 'looking' && (
          <div style={{ textAlign: 'center', color: '#C9BCA3', zIndex: 2 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase' }}>
              Ищем в источниках
            </div>
            {phase.isbn && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginTop: 10, color: '#F3ECDD' }}>
                {phase.isbn}
              </div>
            )}
          </div>
        )}

        {phase.kind === 'manual' && (
          <form
            style={{ zIndex: 2, width: 'min(88vw, 340px)' }}
            onSubmit={(e) => {
              e.preventDefault();
              const clean = manualIsbn.replace(/[^0-9Xx]/g, '');
              if (clean.length === 10 || clean.length === 13) void lookup(clean);
            }}
          >
            <label className="label-mono" style={{ color: '#9C917E' }} htmlFor="isbn">
              ISBN с задней обложки
            </label>
            <input
              id="isbn"
              className="input"
              value={manualIsbn}
              onChange={(e) => setManualIsbn(e.target.value)}
              placeholder="978-5-…"
              inputMode="numeric"
              autoFocus
              style={{ background: '#1A1610', borderColor: '#4A4235', color: '#F3ECDD' }}
            />
            <button className="btn btn--stamp" style={{ width: '100%', marginTop: 12 }} type="submit">
              Найти
            </button>
          </form>
        )}

        {phase.kind === 'error' && (
          <div style={{ zIndex: 2, textAlign: 'center', padding: '0 32px', color: '#C9BCA3' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, lineHeight: 1.5 }}>{phase.message}</div>
            <button className="btn btn--ghost" style={{ marginTop: 18, borderColor: '#4A4235', color: '#F3ECDD' }} onClick={() => setPhase({ kind: 'camera' })}>
              Ещё раз
            </button>
          </div>
        )}
      </div>

      {phase.kind !== 'found' && (
        <>
          <p className="hint">
            {cameraNote ?? (
              <>
                Наведите на штрих-код с задней обложки.
                <br />
                Он же ISBN — распознаётся сам.
              </>
            )}
          </p>
          <div className="actions">
            <label className="btn btn--ghost" style={{ cursor: 'pointer' }}>
              Фото из галереи
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <button
              className="btn btn--ghost"
              onClick={() => setPhase(phase.kind === 'manual' ? { kind: 'camera' } : { kind: 'manual' })}
            >
              {phase.kind === 'manual' ? 'Камера' : 'Ввести ISBN'}
            </button>
          </div>
        </>
      )}

      {phase.kind === 'found' && <FoundSheet result={phase.result} saving={saving} onAdd={add} onRetry={() => setPhase({ kind: 'camera' })} />}
    </div>
  );
}

/**
 * Ничего не нашлось. Главное действие — отложить штрих-код в стопку «на разбор»:
 * руками книгу заводить проще потом, за столом, а не стоя у полки.
 */
function NotFoundSheet({ result, onRetry }: { result: LookupResult; onRetry: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');

  const defer = async () => {
    setState('saving');
    try {
      await api.defer(result.isbn);
      await qc.invalidateQueries({ queryKey: ['unresolved'] });
      await qc.invalidateQueries({ queryKey: ['stats'] });
      setState('done');
    } catch {
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className="sheet">
        <div className="grip" />
        <div className="found" style={{ color: 'var(--sage)' }}>{Icons.check} Отложено на разбор</div>
        <p className="sheet-text">Штрих-код сохранён. Разобрать можно потом — в каталоге появится напоминание.</p>
        <div className="row">
          <button className="btn btn--stamp" onClick={onRetry}>Сканировать ещё</button>
          <button className="btn btn--ghost" onClick={() => navigate('/unresolved')}>К стопке</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet">
      <div className="grip" />
      <div className="found" style={{ color: 'var(--ink-faint)' }}>Ни один источник не знает этот ISBN</div>
      <p className="sheet-text">
        Так бывает с самиздатом, старыми и подарочными изданиями.
        {result.pendingAttempts
          ? ` Этот штрих-код уже в стопке — попыток было ${result.pendingAttempts}.`
          : ' Отложим штрих-код, чтобы не потерялся.'}
      </p>
      <div className="row">
        <button className="btn btn--stamp" onClick={defer} disabled={state === 'saving'}>
          {state === 'saving' ? 'Откладываем…' : result.pendingAttempts ? 'Отметить попытку' : 'Отложить на разбор'}
        </button>
        <button className="btn btn--ghost" onClick={onRetry}>Ещё раз</button>
      </div>
      <p className="src">ISBN {result.isbn}</p>
    </div>
  );
}

function FoundSheet({
  result,
  saving,
  onAdd,
  onRetry,
}: {
  result: LookupResult;
  saving: boolean;
  onAdd: () => void;
  onRetry: () => void;
}) {
  const navigate = useNavigate();

  if (result.alreadyInLibrary) {
    return (
      <div className="sheet">
        <div className="grip" />
        <div className="found" style={{ color: 'var(--amber)' }}>
          {Icons.check} Эта книга уже в каталоге
        </div>
        <div className="hit">
          <Cover title={result.title ?? result.isbn} authors={result.authors} src={result.coverUrl} />
          <div>
            <div className="bt">{result.title}</div>
            <div className="ba">{result.authors}</div>
          </div>
        </div>
        <div className="row">
          <button className="btn btn--primary" onClick={() => navigate(`/book/${result.alreadyInLibrary}`, { replace: true })}>
            Открыть карточку
          </button>
          <button className="btn btn--ghost" onClick={onRetry}>
            Сканировать ещё
          </button>
        </div>
      </div>
    );
  }

  if (!result.found) return <NotFoundSheet result={result} onRetry={onRetry} />;

  const meta = [
    `ISBN ${result.isbn}`,
    [result.publisher, result.year].filter(Boolean).join(', '),
    result.pages ? `${result.pages} с.` : null,
    result.binding,
  ].filter(Boolean);

  // Видно, какой источник дал название — это чинит доверие к автоподстановке.
  const who = [...new Set(Object.values(result.sources))].join(', ');

  return (
    <div className="sheet">
      <div className="grip" />
      <div className="found" style={{ color: 'var(--sage)' }}>
        {Icons.check} Найдено за {(result.tookMs / 1000).toFixed(1).replace('.', ',')} с
      </div>

      <div className="hit">
        <Cover title={result.title ?? ''} authors={result.authors} src={result.coverUrl} />
        <div style={{ minWidth: 0 }}>
          <div className="bt">{result.title}</div>
          <div className="ba">{result.authors || 'Автор не указан'}</div>
          <div className="bm">
            {meta.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="row">
        <button className="btn btn--stamp" onClick={onAdd} disabled={saving}>
          {saving ? 'Сохраняем…' : 'В каталог'}
        </button>
        <button className="btn btn--ghost" onClick={onRetry} disabled={saving}>
          Не та книга
        </button>
      </div>

      <p className="src">источники: {who || '—'}</p>
    </div>
  );
}

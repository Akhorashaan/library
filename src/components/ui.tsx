import type { ReactNode } from 'react';
import type { ReadingStatus } from '@shared/schema';

/* ─────────────────────────────── Штампы ────────────────────────────── */

const STATUS_LABEL: Record<ReadingStatus, string> = {
  none: '',
  queued: 'В очереди',
  reading: 'Читаю',
  read: 'Прочитано',
  abandoned: 'Брошена',
};

/** Дата коротко, как на библиотечном штампе: 12.03.26 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function Stamp({
  status,
  date,
  mini,
  flat,
}: {
  status: ReadingStatus;
  date?: string | null;
  mini?: boolean;
  flat?: boolean;
}) {
  if (status === 'none') return null;
  const label = STATUS_LABEL[status];
  // В списке дата не помещается и выдавливает метаданные книги на три строки;
  // «когда прочитал» видно на карточке, где для этого есть место.
  const suffix = status === 'read' && date && !mini ? ` · ${shortDate(date)}` : '';
  return (
    <span className={`stamp stamp--${status}${mini ? ' stamp--mini' : ''}${flat ? ' stamp--flat' : ''}`}>
      {label}
      {suffix}
    </span>
  );
}

/** Отдельный штамп «книга не дома» — для домашней библиотеки это важнее статуса. */
export function LentStamp({ to, mini }: { to?: string | null; mini?: boolean }) {
  if (!to) return null;
  return <span className={`stamp stamp--lent${mini ? ' stamp--mini' : ''}`}>У {to}</span>;
}

/* ─────────────────────────────── Иконки ────────────────────────────── */

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {path}
  </svg>
);

export const Icons = {
  search: icon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  catalog: icon(<path d="M4 5h6v14H4zM14 5h6v14h-6z" />),
  list: icon(<path d="M4 6h16M4 12h16M4 18h10" />),
  barcode: icon(
    <path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3M7 8v8M10 8v8M13.5 8v8M17 8v8" />
  ),
  back: icon(<path d="M15 5l-7 7 7 7" />),
  edit: icon(<path d="M4 20h4L19 9l-4-4L4 16z" />),
  check: icon(<path d="M4 12.5l5.5 5.5L20 7" />),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  grid: icon(
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  trash: icon(<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />),
  filter: icon(<path d="M4 6h16M7 12h10M10 18h4" />),
};

/* ────────────────────────────── Состояния ──────────────────────────── */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="cat-card" aria-hidden="true">
      <div className="skeleton" style={{ width: 42, height: 62, flex: 'none' }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 15, width: '70%', marginBottom: 7 }} />
        <div className="skeleton" style={{ height: 12, width: '45%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 9, width: '60%' }} />
      </div>
    </div>
  );
}

/** Полоса прогресса чтения: страница N из M. */
export function Progress({ value, total, right }: { value: number; total?: number | null; right?: string }) {
  const pct = total && total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="progress">
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="lbl">
        <span>{total ? `${value} из ${total}` : `${value} с.`}</span>
        <span>{right ?? `${pct}%`}</span>
      </div>
    </div>
  );
}

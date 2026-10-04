import { useNavigate } from 'react-router';
import type { Book } from '@/lib/api';
import { Cover } from './Cover';
import { LentStamp, Stamp } from './ui';

/** Строка каталога — каталожная карточка из ящика. */
export function BookCard({ book }: { book: Book }) {
  const navigate = useNavigate();

  const meta = [
    book.shelfmark,
    [book.publisher, book.year].filter(Boolean).join(', '),
    book.pages ? `${book.pages} с.` : null,
  ].filter(Boolean);

  return (
    <button className="cat-card" onClick={() => navigate(`/book/${book.id}`)}>
      <Cover title={book.title} authors={book.authors} src={book.coverUrl} />

      <div className="info">
        <div className="bt">{book.title}</div>
        <div className="ba">{book.authors || 'Автор не указан'}</div>
        {book.series && <div className="series-label">{book.series}{book.seriesOrder != null ? ` · ${book.seriesOrder}${book.seriesEnd && book.seriesEnd !== book.seriesOrder ? `–${book.seriesEnd}` : ''}` : ''}</div>}
        {(book.tags ?? []).length > 0 && <div className="book-tags">{book.tags.map((t) => <span key={t}>#{t}</span>)}</div>}
        <div className="bm">
          {meta.map((m, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <i>·</i>}
              <span>{m}</span>
            </span>
          ))}
        </div>
      </div>

      {(book.lentTo || book.status !== 'none') && <div className="right">
        {book.lentTo && <LentStamp to={book.lentTo} mini />}
        <Stamp status={book.status} date={book.finishedAt} mini />
      </div>}
    </button>
  );
}

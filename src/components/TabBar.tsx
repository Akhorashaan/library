import { NavLink, useLocation } from 'react-router';
import { Icons } from './ui';

/**
 * Снизу на телефоне, слева на десктопе — одна разметка, разное расположение
 * задаётся в CSS. «Скан» приподнят: это главное действие приложения.
 */
export function TabBar() {
  const { pathname } = useLocation();
  // На экране сканера панель мешает: он занимает весь экран.
  if (pathname === '/scan') return null;

  return (
    <nav className="tabbar">
      <NavLink to="/" data-on={pathname === '/' || pathname.startsWith('/book') ? '' : undefined}>
        {Icons.catalog}
        <span>Каталог</span>
      </NavLink>

      <NavLink to="/reading" data-on={pathname === '/reading' ? '' : undefined}>
        {Icons.list}
        <span>Список</span>
      </NavLink>

      <NavLink to="/scan" className="scan">
        <span className="disc">{Icons.barcode}</span>
        <span>Скан</span>
      </NavLink>
    </nav>
  );
}

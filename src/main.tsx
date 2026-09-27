import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/app.css';

import { TabBar } from './components/TabBar';
import { Catalog } from './pages/Catalog';
import { Reading } from './pages/Reading';
import { BookPage } from './pages/BookPage';
import { Scan } from './pages/Scan';
import { Unresolved } from './pages/Unresolved';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Каталог меняется только когда его меняешь ты — перезапрашивать
      // при каждом фокусе окна незачем.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="shell">
          <TabBar />
          <div className="main-col">
            <Routes>
              <Route path="/" element={<Catalog />} />
              <Route path="/reading" element={<Reading />} />
              <Route path="/book/:id" element={<BookPage />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="/unresolved" element={<Unresolved />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);

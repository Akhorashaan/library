import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

const API_PORT = process.env.PORT ?? 3017;
const basePath = process.env.APP_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath)) {
  throw new Error('APP_BASE_PATH must be / or a path such as /library/ with a trailing slash');
}

/**
 * Камеру браузер отдаёт только в защищённом контексте: HTTPS или localhost.
 * По локальной сети (http://192.168.…) сканер работать не будет — это правило
 * браузера, а не приложения. HTTPS=1 поднимает dev-сервер с самоподписанным
 * сертификатом, чтобы сканер можно было проверить с телефона.
 */
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      scope: basePath,
      useCredentials: true,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Картотека',
        short_name: 'Картотека',
        description: 'Домашняя библиотека: каталог, сканер ISBN, списки чтения',
        lang: 'ru',
        id: basePath,
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        background_color: '#E0D5C0',
        theme_color: '#A8342A',
        icons: [
          { src: `${basePath}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: `${basePath}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Оболочка приложения — в кэш, чтобы каталог открывался у полки,
        // куда не добивает домашний wifi.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: `${basePath}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${basePath}(?:api|covers)(?:/|$)`)],
        runtimeCaching: [
          {
            // Обложки не меняются никогда — раз скачали, держим локально.
            urlPattern: new RegExp(`^https?://[^/]+${basePath}covers/`),
            handler: 'CacheFirst',
            options: {
              cacheName: `kartoteka-covers-${basePath}`,
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Каталог показываем из кэша сразу, обновляем в фоне.
            urlPattern: new RegExp(`^https?://[^/]+${basePath}api/(?:books|lists)(?:[/?]|$)`),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: `kartoteka-catalog-${basePath}` },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: useHttps ? 5184 : 5183,
    strictPort: true,
    proxy: {
      [`${basePath}api`]: {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        rewrite: (path) => `/${path.slice(basePath.length)}`,
      },
      [`${basePath}covers`]: {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        rewrite: (path) => `/${path.slice(basePath.length)}`,
      },
    },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});

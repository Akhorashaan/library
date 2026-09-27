import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

const API_PORT = process.env.PORT ?? 3017;

/**
 * Камеру браузер отдаёт только в защищённом контексте: HTTPS или localhost.
 * По локальной сети (http://192.168.…) сканер работать не будет — это правило
 * браузера, а не приложения. HTTPS=1 поднимает dev-сервер с самоподписанным
 * сертификатом, чтобы сканер можно было проверить с телефона.
 */
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Картотека',
        short_name: 'Картотека',
        description: 'Домашняя библиотека: каталог, сканер ISBN, списки чтения',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#E0D5C0',
        theme_color: '#A8342A',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Оболочка приложения — в кэш, чтобы каталог открывался у полки,
        // куда не добивает домашний wifi.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/covers/],
        runtimeCaching: [
          {
            // Обложки не меняются никогда — раз скачали, держим локально.
            urlPattern: /\/covers\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'covers',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Каталог показываем из кэша сразу, обновляем в фоне.
            urlPattern: /\/api\/(books|lists).*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalog' },
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
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/covers': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});

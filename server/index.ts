import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSchema } from './db/index.js';
import { registerRoutes } from './routes.js';
import { COVERS_DIR } from './covers.js';

const PORT = Number(process.env.PORT ?? 3017);
const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: isProd
    ? true
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
});

initSchema();
await registerRoutes(app);

// Обложки лежат в data/covers и отдаются как статика: скачали один раз —
// дальше ни одного обращения наружу, в том числе офлайн.
await app.register(fastifyStatic, {
  root: COVERS_DIR,
  prefix: '/covers/',
  decorateReply: false,
  maxAge: '365d',
  immutable: true,
});

// В деве фронт крутит Vite и сам проксирует /api сюда. В проде тот же процесс
// отдаёт и собранную статику — один порт, один контейнер.
const clientDir = resolve('dist/client');
if (isProd && existsSync(clientDir)) {
  await app.register(fastifyStatic, { root: clientDir, prefix: '/', decorateReply: true });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/covers')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html'); // SPA-роутинг
  });
}

app.get('/api/health', async () => ({ ok: true }));

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`Картотека: http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

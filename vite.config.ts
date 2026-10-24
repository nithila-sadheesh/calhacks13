// Vite config. `fixtures/` is the public dir, so the app fetches
// /demo-drive/*.json, /demo-drive/video.mp4 and /audio/* at runtime.
// In dev, /api/<name> runs the web-standard handler exported from server/<name>.ts, the same
// handler Vercel serves from api/<name>.ts in production. .env is loaded for those handlers only.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.match(/^\/api\/([\w-]+)(?:\?|$)/)?.[1];
        if (!name) return next();
        const file = `/server/${name}.ts`;
        if (!existsSync(resolve(server.config.root, `.${file}`))) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const mod: Record<string, unknown> = await server.ssrLoadModule(file);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end();
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          // Body-less requests only; the token endpoint is a GET.
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
          });
          const response = (await handler(request)) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  publicDir: 'fixtures',
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'] },
});

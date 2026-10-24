// Vite config. `fixtures/` is the public dir, so the app fetches
// /demo-drive/*.json, /demo-drive/video.mp4 and /audio/* at runtime.
// In dev, /api/<name> runs the web-standard handler exported from api/<name>.ts, the same
// handler Vercel serves from api/<name>.ts in production. .env is loaded for those handlers only.
// HTTPS=1 (set by `npm run phone`) serves over HTTPS with the certificate in .certs/.
import { existsSync, readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
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
        const file = `/api/${name}.ts`;
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
          // Over HTTPS Vite speaks HTTP/2: skip its pseudo-headers (:authority, :path, ...),
          // which are not valid header names, and take the host from :authority.
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string' && !key.startsWith(':')) headers.set(key, value);
          }
          const authority = req.headers[':authority'];
          const host = req.headers.host ?? (typeof authority === 'string' ? authority : '');
          // The handlers compare Origin with this URL, so the scheme must be the real one.
          const scheme = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
          const request = new Request(`${scheme}://${host}${req.url}`, {
            method: req.method,
            headers,
            body: hasBody ? Buffer.concat(chunks) : undefined,
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

const https =
  process.env.HTTPS === '1'
    ? { key: readFileSync('.certs/dev-key.pem'), cert: readFileSync('.certs/dev-cert.pem') }
    : undefined;

export default defineConfig({
  plugins: [react(), devApi()],
  publicDir: 'fixtures',
  server: { https },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**'] },
});

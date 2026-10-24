// Local launcher serves the same token implementation as the Vercel function.
import { createServer } from 'vite';
import { GET } from '../../api/cartesia-token.ts';

const server = await createServer({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [
    {
      name: 'voice-spike-token',
      configureServer(vite) {
        vite.middlewares.use('/api/cartesia-token', async (req, res) => {
          try {
            const headers = new Headers();
            if (req.headers.origin) headers.set('origin', req.headers.origin);
            if (typeof req.headers['sec-fetch-site'] === 'string')
              headers.set('sec-fetch-site', req.headers['sec-fetch-site']);
            const response = await GET(
              new Request('http://127.0.0.1:5173/api/cartesia-token', {
                method: req.method ?? 'GET',
                headers,
              }),
            );
            res.statusCode = response.status;
            response.headers.forEach((value, name) => res.setHeader(name, value));
            res.end(await response.text());
          } catch {
            res.statusCode = 500;
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ error: 'Local token handler failed.' }));
          }
        });
      },
    },
  ],
});
await server.listen();
console.log('Voice spike: http://127.0.0.1:5173/app/src/voice/spike.html');

import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function localSuggestionFunction(apiKey: string): Plugin {
  return {
    name: 'local-ai-label-function',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/.netlify/functions/suggest-label', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }

        void (async () => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            if (apiKey) process.env.OPENAI_API_KEY = apiKey;
            const { default: handler } = await server.ssrLoadModule('/netlify/functions/suggest-label.ts');
            const result: Response = await handler(new Request('http://localhost/.netlify/functions/suggest-label', {
              method: 'POST',
              headers: { 'Content-Type': String(request.headers['content-type'] ?? '') },
              body: new Uint8Array(Buffer.concat(chunks)),
            }));
            response.statusCode = result.status;
            result.headers.forEach((value, name) => response.setHeader(name, value));
            response.end(await result.text());
          } catch (error) {
            console.error('A helyi AI-felirat végpont hibája:', error);
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ error: 'A helyi AI-felirat végpont hibája.' }));
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'OPENAI_');
  return {
    base: '/',
    plugins: [
      localSuggestionFunction(env.OPENAI_API_KEY ?? ''),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Property PhotoSheet – Ingatlan Fotólap',
          short_name: 'Fotólap',
          lang: 'hu',
          description: 'Offline fotólap-készítő ingatlan-értékbecsléshez',
          theme_color: '#234b34',
          background_color: '#f4f5f1',
          display: 'standalone',
          orientation: 'any',
          start_url: './',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ttf,txt}'],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});

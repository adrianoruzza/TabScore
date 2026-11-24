import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function resolvePublicGoogleOAuthClientId(): string {
  const isValidClientId = (val: unknown): val is string =>
    typeof val === 'string' &&
    !/^AIza/i.test(val.trim()) &&
    /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(val.trim());

  const fromEnv = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (isValidClientId(fromEnv)) {
    return fromEnv.trim();
  }

  // Strictly read ONLY the public oAuthClientId field; never read or expose apiKey.
  for (const relPath of ['firebase-applet-config.json', 'oauth-public-config.json']) {
    try {
      const fullPath = path.resolve(__dirname, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as {
        oAuthClientId?: unknown;
      };
      if (isValidClientId(parsed.oAuthClientId)) {
        return parsed.oAuthClientId.trim();
      }
    } catch {
      // Ignore missing or unreadable config files
    }
  }

  return '';
}

export default defineConfig(() => {
  const rawBase = process.env.VITE_BASE_PATH?.trim() || '/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const googleOAuthClientId = resolvePublicGoogleOAuthClientId();

  return {
    base,
    define: {
      'import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(
        googleOAuthClientId
      ),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifestFilename: 'manifest.webmanifest',
        includeAssets: [
          'favicon.ico',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'assets/aistudio/TabScore_34d66820.png',
        ],
        manifest: {
          id: base,
          name: 'TabScore',
          short_name: 'TabScore',
          description:
            'Registro operativo per la gestione e valutazione delle tavole di disegno tecnico e delle consegne delle cartelline.',
          lang: 'it',
          theme_color: '#1d4ed8',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'any',
          start_url: base,
          scope: base,
          categories: ['education', 'productivity'],
          icons: [
            {
              src: `${base}pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-maskable-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2,webmanifest}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

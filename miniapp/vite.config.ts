import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// WDK targets Node/Bare; in a browser/Telegram webview it needs node built-in
// shims (buffer, crypto, stream, events) which this plugin injects.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'events', 'util', 'process', 'vm'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    global: 'globalThis',
  },
  // /api is proxied to the local backend so the tunnel-served app calls it
  // same-origin. Shared by dev and preview.
  server: {
    host: true, // needed for tunnel / device testing
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  // Production build served over the tunnel (bundled → fast load, unlike dev's
  // hundreds of unbundled module requests). Same /api proxy as dev.
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'es2020',
  },
});

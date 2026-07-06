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
  server: {
    host: true, // needed for ngrok / device testing
    port: 5173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
  },
});

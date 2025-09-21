import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external connections (for mobile testing)
    allowedHosts: [
      'localhost',
      '*.ngrok.io',
      '*.ngrok-free.app',
      '9bcf22e36f76.ngrok-free.app',
      '9054d2eee495.ngrok-free.app'
    ],
    proxy: {
      // Proxy WebSocket requests to AI server
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  }
});

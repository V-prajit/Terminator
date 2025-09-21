import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external connections (for mobile testing)
    allowedHosts: 'all', // Allow all hosts for demo purposes
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

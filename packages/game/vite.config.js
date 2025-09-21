import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0', // Allow external connections (for mobile testing)
    allowedHosts: ['all', 'f938ebfa9c0b.ngrok-free.app'], // Allow all hosts for demo purposes
    disableHostCheck: true
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

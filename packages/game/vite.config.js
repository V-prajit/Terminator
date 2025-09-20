import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: true, // Allow external connections (for mobile testing)
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  }
});

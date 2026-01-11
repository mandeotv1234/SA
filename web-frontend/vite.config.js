import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on 0.0.0.0 for Docker access
    port: 5173,
    proxy: {
      // Internal Vite proxy (container -> container)
      '/api': 'http://kong:8000',
      '/auth': 'http://kong:8000',
      '/socket.io': {
        target: 'http://stream-service:3000', // Direct to stream service for WS if Kong fails, or kong:8000
        ws: true,
        rewrite: (path) => path.replace(/^\/socket.io/, '/socket.io')
      }
    }
  }
});

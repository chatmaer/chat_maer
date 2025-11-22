import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        secure: false,
        // Suppress WebSocket proxy errors in development
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            // Only log if it's not a connection reset/abort (common during dev server restarts)
            if (err.code !== 'ECONNRESET' && err.code !== 'ECONNABORTED') {
              console.error('Proxy error:', err);
            }
          });
          proxy.on('proxyReqWs', (proxyReq, _req, _socket) => {
            // Handle WebSocket upgrade errors silently
            proxyReq.on('error', (err) => {
              if (err.code !== 'ECONNRESET' && err.code !== 'ECONNABORTED') {
                console.error('WebSocket proxy error:', err);
              }
            });
          });
        },
      },
    },
  },
  preview: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        secure: false,
        // Suppress WebSocket proxy errors in preview
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            // Only log if it's not a connection reset/abort (common during dev server restarts)
            if (err.code !== 'ECONNRESET' && err.code !== 'ECONNABORTED') {
              console.error('Proxy error:', err);
            }
          });
          proxy.on('proxyReqWs', (proxyReq, _req, _socket) => {
            // Handle WebSocket upgrade errors silently
            proxyReq.on('error', (err) => {
              if (err.code !== 'ECONNRESET' && err.code !== 'ECONNABORTED') {
                console.error('WebSocket proxy error:', err);
              }
            });
          });
        },
      },
    },
  },
});

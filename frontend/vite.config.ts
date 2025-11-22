import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom plugin to suppress WebSocket proxy errors
const suppressWsErrors = () => {
  return {
    name: 'suppress-ws-errors',
    configureServer(server) {
      // Intercept console.error to filter out WebSocket proxy errors
      const originalError = console.error;
      console.error = (...args: any[]) => {
        const message = args[0]?.toString() || '';
        // Suppress Vite's WebSocket proxy socket errors
        if (
          message.includes('ws proxy socket error') ||
          message.includes('ECONNABORTED') ||
          message.includes('ECONNRESET') ||
          (args[0] instanceof Error && 
           (args[0].message?.includes('ECONNABORTED') || 
            args[0].message?.includes('ECONNRESET')))
        ) {
          // Silently ignore these errors
          return;
        }
        // Log other errors normally
        originalError.apply(console, args);
      };
    },
  };
};

// Custom plugin to show frontend port status
const showPortStatus = () => {
  return {
    name: 'show-port-status',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          const host = address.address === '::' ? 'localhost' : address.address;
          
          console.log('\n' + '='.repeat(60));
          console.log('🚀 Frontend Server Status');
          console.log('='.repeat(60));
          console.log(`✅ Server is running successfully!`);
          console.log(`📡 Port: ${port}`);
          console.log(`🌐 Local URL: http://localhost:${port}`);
          if (host !== 'localhost' && host !== '127.0.0.1') {
            console.log(`🌍 Network URL: http://${host}:${port}`);
          }
          console.log('='.repeat(60) + '\n');
        }
      });
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), suppressWsErrors(), showPortStatus()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  logLevel: 'warn', // Reduce console noise - only show warnings and errors
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
          // Suppress all proxy errors - they're handled at socket level
          proxy.on('error', () => {
            // Silently ignore - these are common during dev server restarts
          });
          
          proxy.on('proxyReqWs', (proxyReq, _req, _socket) => {
            // Suppress all WebSocket upgrade errors
            proxyReq.on('error', () => {
              // Silently ignore
            });
            
            // Suppress socket write errors (ECONNABORTED occurs here)
            _socket.on('error', () => {
              // Silently ignore - common during connection interruptions
            });
            
            // Handle errors on the proxy request socket
            if (proxyReq.socket) {
              proxyReq.socket.on('error', () => {
                // Silently ignore
              });
            }
            
            // Also suppress errors on the client socket
            if (_req.socket) {
              _req.socket.on('error', () => {
                // Silently ignore
              });
            }
          });
          
          // Suppress proxy request errors
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.on('error', () => {
              // Silently ignore
            });
            if (proxyReq.socket) {
              proxyReq.socket.on('error', () => {
                // Silently ignore
              });
            }
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
          // Suppress all proxy errors - they're handled at socket level
          proxy.on('error', () => {
            // Silently ignore - these are common during dev server restarts
          });
          
          proxy.on('proxyReqWs', (proxyReq, _req, _socket) => {
            // Suppress all WebSocket upgrade errors
            proxyReq.on('error', () => {
              // Silently ignore
            });
            
            // Suppress socket write errors (ECONNABORTED occurs here)
            _socket.on('error', () => {
              // Silently ignore - common during connection interruptions
            });
            
            // Handle errors on the proxy request socket
            if (proxyReq.socket) {
              proxyReq.socket.on('error', () => {
                // Silently ignore
              });
            }
            
            // Also suppress errors on the client socket
            if (_req.socket) {
              _req.socket.on('error', () => {
                // Silently ignore
              });
            }
          });
          
          // Suppress proxy request errors
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.on('error', () => {
              // Silently ignore
            });
            if (proxyReq.socket) {
              proxyReq.socket.on('error', () => {
                // Silently ignore
              });
            }
          });
        },
      },
    },
  },
});

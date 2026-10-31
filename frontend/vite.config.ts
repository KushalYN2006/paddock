import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.API_PROXY_TARGET;
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.replaceAll('\\', '/').includes('/node_modules/three/')) return 'three-vendor';
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      proxy: proxyTarget ? { '/api/v1': { target: proxyTarget, changeOrigin: true }, '/health': { target: proxyTarget, changeOrigin: true } } : undefined,
    },
  };
});

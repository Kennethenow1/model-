import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.WLT_API_KEY || '';

  return {
    optimizeDeps: {
      include: ['@mediapipe/tasks-vision'],
    },
    server: {
      host: 'localhost',
      port: 5174,
      strictPort: true,
      open: false,
      proxy: {
        // Browser calls /api/worldlabs/... → https://api.worldlabs.ai/marble/v1/...
        '/api/worldlabs': {
          target: 'https://api.worldlabs.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/worldlabs/, '/marble/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const override = req.headers['x-wlt-api-key'];
              const key = override || apiKey;
              if (key) {
                proxyReq.setHeader('WLT-Api-Key', key);
              }
            });
          },
        },
      },
    },
  };
});

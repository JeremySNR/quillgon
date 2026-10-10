import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In development the UI is served by Vite, not the Quillgon server, so Vite injects the
 * API token the server expects. `pnpm dev` (scripts/dev.mjs) gives both the same token.
 */
function apiToken(): Plugin {
  return {
    name: 'quillgon-api-token',
    apply: 'serve',
    transformIndexHtml(html) {
      const token = process.env.QUILLGON_TOKEN;
      if (!token) return html;
      return html.replace('</head>', `  <meta name="quillgon-token" content="${token}" />\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), apiToken()],
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500},
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Locally, build into backend/public so Express can serve the dashboard.
// Vercel sets VERCEL=1; its build must stay inside the frontend project root.
const isVercel = process.env.VERCEL === '1';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: isVercel ? 'dist' : '../backend/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
});

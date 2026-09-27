import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  build:{outDir:'../backend/public',emptyOutDir:true},
  server:{proxy:{'/api':'http://localhost:4000','/socket.io':{target:'http://localhost:4000',ws:true}}},
});

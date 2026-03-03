import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    // Proxy /api to the Express server during local development
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})

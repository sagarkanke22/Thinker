import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite dev server. /api/* is proxied to the FastAPI backend so the frontend
// can use relative URLs everywhere ("/api/render" etc.) and switching
// environments only requires updating this proxy target.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

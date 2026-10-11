import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  },
  publicDir: 'src/client/public',
  server: {
    port: 5174,
    watch: { ignored: ['**/data/**'] },
    proxy: {
      '/api': {
        target: process.env.LINAI_DEV_API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
})

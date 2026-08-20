import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // Proxies to `wrangler dev` (run alongside `npm run dev`) so the anomaly-summary
    // Worker endpoint works locally without a separate fetch base URL in the app code.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
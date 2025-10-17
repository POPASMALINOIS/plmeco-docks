// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Publicado en https://popasmalinois.github.io/plmeco-docks/
// Para Project Pages, la base debe ser '/<NOMBRE_REPO>/'
export default defineConfig({
  plugins: [react()],
  base: '/plmeco-docks/',
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
})

// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/<plmeco-docks>/', // <-- importante para GitHub Pages (Project Pages)
})

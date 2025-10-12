import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  base: '/plmeco-docks/' // <- si tu repo se llama distinto, cámbialo
})

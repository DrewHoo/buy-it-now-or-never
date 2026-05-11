import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/buy-it-now-or-never/',
  plugins: [react()],
})

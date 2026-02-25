// @ts-check
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [react()],
  server: { port: 7701 },
  vite: {
    plugins: [tailwindcss()],
  },
})

// @ts-check
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { FontaineTransform } from 'fontaine'

export default defineConfig({
  site: 'https://rollhook.com',
  integrations: [react(), sitemap()],
  server: { port: 7701 },
  vite: {
    plugins: [
      tailwindcss(),
      // Generates metric-matched @font-face fallbacks so font-display: swap
      // is visually seamless once basalt-ui ships the block → swap update.
      FontaineTransform.vite({
        fallbacks: {
          'Instrument Sans Variable': ['Helvetica Neue', 'Segoe UI', 'Roboto', 'Arial'],
          'JetBrains Mono Variable': ['Consolas', 'Menlo', 'SF Mono', 'Courier New'],
        },
        // @fontsource-variable URLs are module specifiers, not relative paths —
        // fontaine needs an explicit resolver to find the font files.
        resolvePath: id => new URL(`node_modules/${id}`, import.meta.url),
      }),
    ],
  },
})

/**
 * Generates apps/marketing/public/og.png — run once when branding changes:
 *   bun run scripts/gen-og.ts  (from apps/marketing)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bunStore = resolve(__dirname, '../../../node_modules/.bun')

function findFontFile(pkgPrefix: string, filename: string) {
  const dirs = readdirSync(bunStore)
  const dir = dirs.find(d => d.startsWith(pkgPrefix))
  if (!dir)
    throw new Error(`Package not found: ${pkgPrefix}`)
  const path = resolve(bunStore, dir, 'node_modules', pkgPrefix.replace('+', '/').replace(/^@/, '@'), 'files', filename)
  return readFileSync(path)
}

const monoFont = findFontFile('@fontsource+jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff')
const sansFont = findFontFile('@fontsource+instrument-sans', 'instrument-sans-latin-400-normal.woff')

const svg = await satori(
  // @ts-expect-error satori accepts plain VNode objects; ReactElement requirement is overly strict
  {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1f25',
        padding: '72px 80px',
        fontFamily: '"Instrument Sans"',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '20px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: '"JetBrains Mono"',
                    fontSize: '22px',
                    fontWeight: 700,
                    color: '#6b7280',
                    letterSpacing: '0.05em',
                  },
                  children: 'rollhook.com',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: '"JetBrains Mono"',
                    fontSize: '80px',
                    fontWeight: 700,
                    color: '#f4f4f5',
                    lineHeight: 1.1,
                    letterSpacing: '-0.02em',
                  },
                  children: 'RollHook',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '32px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '32px',
                    fontWeight: 400,
                    color: '#9ca3af',
                    lineHeight: 1.4,
                    maxWidth: '900px',
                  },
                  children:
                    'Zero-downtime rolling Docker Compose deployments via webhooks.',
                },
              },
              {
                type: 'div',
                props: {
                  style: { display: 'flex', gap: '16px' },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontFamily: '"JetBrains Mono"',
                          fontSize: '18px',
                          fontWeight: 700,
                          color: '#4b5563',
                          backgroundColor: '#2a2b33',
                          padding: '8px 16px',
                          borderRadius: '6px',
                        },
                        children: 'Self-hosted',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontFamily: '"JetBrains Mono"',
                          fontSize: '18px',
                          fontWeight: 700,
                          color: '#4b5563',
                          backgroundColor: '#2a2b33',
                          padding: '8px 16px',
                          borderRadius: '6px',
                        },
                        children: 'Docker Compose',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontFamily: '"JetBrains Mono"',
                          fontSize: '18px',
                          fontWeight: 700,
                          color: '#4b5563',
                          backgroundColor: '#2a2b33',
                          padding: '8px 16px',
                          borderRadius: '6px',
                        },
                        children: 'GitHub Actions',
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Instrument Sans', data: sansFont, style: 'normal', weight: 400 },
      { name: 'JetBrains Mono', data: monoFont, style: 'normal', weight: 700 },
    ],
  },
)

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
const png = resvg.render().asPng()

const out = resolve(__dirname, '../public/og.png')
writeFileSync(out, new Uint8Array(png))
console.log(`Written ${png.byteLength.toLocaleString()} bytes → ${out}`)

// Visual evidence: full-page-ish viewport shots for each entry at desktop and mobile widths.
// Run: node tools/shots.mjs --out=docs/运营准备/evidence-visual-2026-10-21
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = new Map(process.argv.slice(2).map((raw) => {
  const [key, ...rest] = raw.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const base = (args.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const outDir = resolve(__dirname, '..', '..', args.get('out') || 'docs/运营准备/evidence-visual')
const pages = (args.get('pages') || 'index,community').split(',')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: '1440', width: 1440, height: 1000 },
  { name: '390', width: 390, height: 844, mobile: true },
]

for (const pageName of pages) {
  for (const viewport of viewports) {
    await withBrowser({
      windowSize: { width: viewport.width, height: viewport.height },
      extraArgs: viewport.mobile ? ['--force-device-scale-factor=1'] : [],
    }, async (session) => {
      await session.navigate(`${base}/${pageName}.html`)
      if (pageName === 'community') {
        await session.clearLocalStorage()
        await session.reload()
        await sleep(400)
        await session.setMembership('member')
        await sleep(600)
      }
      await sleep(500)
      const file = join(outDir, `${pageName}-${viewport.name}.png`)
      await session.screenshot(file)
      const metrics = await session.eval(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        bodyHeight: document.body.scrollHeight,
      }))
      console.log(`[shot] ${file}`, JSON.stringify(metrics))
    })
  }
}

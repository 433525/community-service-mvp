// Capture every community tab and the A+ workbench at desktop/mobile widths.
// Run: node tools/shots-views.mjs --out=docs/运营准备/evidence-visual-views
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
const outDir = resolve(__dirname, '..', '..', args.get('out') || 'docs/运营准备/evidence-visual-views')
const tabs = [
  { label: '首页', slug: 'home' },
  { label: '社区', slug: 'community' },
  { label: '发布', slug: 'publish' },
  { label: '消息', slug: 'messages' },
  { label: '我的', slug: 'profile' },
  { label: '审核', slug: 'moderation' },
]
await mkdir(outDir, { recursive: true })

for (const viewport of [{ name: '1440', width: 1440, height: 1000 }, { name: '390', width: 390, height: 844 }]) {
  await withBrowser({ windowSize: { width: viewport.width, height: viewport.height } }, async (page) => {
    await page.navigate(`${base}/community.html`)
    await page.clearLocalStorage()
    await page.reload()
    await page.setMembership('member')
    for (const tab of tabs) {
      await page.setMembership(tab.slug === 'moderation' ? 'reviewer' : 'member')
      const navSelector = viewport.name === '390' ? '.mobile-nav button' : '.side-nav button'
      const clicked = await page.eval((selector, label) => {
        const node = Array.from(document.querySelectorAll(selector))
          .find((item) => (item.innerText || '').includes(label))
        if (!node) return false
        node.click()
        return true
      }, navSelector, tab.label)
      if (!clicked) throw new Error(`nav ${tab.label} not found`)
      await sleep(450)
      const file = join(outDir, `${tab.slug}-${viewport.name}.png`)
      await page.screenshot(file)
      const metrics = await page.eval(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        height: document.body.scrollHeight,
      }))
      console.log(`[shot] ${file}`, JSON.stringify(metrics))
    }
  })
}

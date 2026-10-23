// Capture key interaction states for visual review (dialogs, forms, detail panels).
// Run: node tools/shots-states.mjs --out=docs/运营准备/evidence-visual-states
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
const outDir = resolve(__dirname, '..', '..', args.get('out') || 'docs/运营准备/evidence-visual-states')
await mkdir(outDir, { recursive: true })

const clickText = (page, selector, text) => page.eval((sel, label) => {
  const node = Array.from(document.querySelectorAll(sel)).find((item) => (item.innerText || '').includes(label))
  if (!node) return false
  node.click()
  return true
}, selector, text)

// A+ desktop: detail + create dialog
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.queue-item')
  await page.clickSelector('.queue-item')
  await sleep(400)
  await page.screenshot(join(outDir, 'aplus-detail-1440.png'))
  await page.eval(() => window.scrollTo(0, 760))
  await sleep(300)
  await page.screenshot(join(outDir, 'aplus-detail-lower-1440.png'))
  await page.eval(() => window.scrollTo(0, 0))
  await clickText(page, 'button', '新建演练记录')
  await sleep(400)
  await page.screenshot(join(outDir, 'aplus-create-1440.png'))
  console.log('[shot] aplus detail/create')
})

// A+ mobile: create dialog
await withBrowser({ windowSize: { width: 390, height: 844 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.clearLocalStorage()
  await page.reload()
  await clickText(page, 'button', '新建演练记录')
  await sleep(400)
  await page.screenshot(join(outDir, 'aplus-create-390.png'))
  console.log('[shot] aplus create mobile')
})

// B: help dialog, safety dialog, publish activity, profile orders
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await page.clickSelector('.help-toggle')
  await sleep(400)
  await page.screenshot(join(outDir, 'community-help-1440.png'))
  await page.eval(() => document.querySelector('.help-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await sleep(300)

  await clickText(page, '.side-nav button', '发布')
  await sleep(300)
  await clickText(page, '.mode-options button', '志愿发布')
  await sleep(250)
  await clickText(page, '.submode-row button', '活动招募')
  await sleep(300)
  await page.screenshot(join(outDir, 'community-publish-activity-1440.png'))
  console.log('[shot] community help + publish activity')
})

// B mobile: messages + profile
await withBrowser({ windowSize: { width: 390, height: 844 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.setMembership('member')
  await clickText(page, '.mobile-nav button', '消息')
  await sleep(400)
  await page.screenshot(join(outDir, 'community-messages-390.png'))
  await clickText(page, '.mobile-nav button', '我的')
  await sleep(400)
  await page.screenshot(join(outDir, 'community-profile-390.png'))
  console.log('[shot] community mobile messages/profile')
})

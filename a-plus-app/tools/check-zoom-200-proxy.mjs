import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

// Layout proxy for 1440×900 at 200%: 720×450 CSS px at DPR 2. This is not a substitute for manual browser-zoom testing.
const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-p1-followups')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const viewport = { width: 720, height: 450, deviceScaleFactor: 2 }
const steps = []
let failures = 0
function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}
async function pageMetrics(page) {
  return page.eval(() => ({
    innerWidth, innerHeight, dpr: devicePixelRatio,
    documentScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    visualScale: visualViewport?.scale ?? 1,
  }))
}
async function dialogMetrics(page, selector) {
  return page.eval((sel) => {
    const dialog = document.querySelector(sel)
    if (!dialog) return { found: false }
    const rect = dialog.getBoundingClientRect()
    return {
      found: true,
      left: Math.round(rect.left), top: Math.round(rect.top),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width), height: Math.round(rect.height),
      withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      focusInside: dialog.contains(document.activeElement),
      overflowY: getComputedStyle(dialog).overflowY,
      pageScrollWidth: document.documentElement.scrollWidth,
    }
  }, selector)
}
async function escapeDialog(page, selector) {
  await page.eval((sel) => document.querySelector(sel)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), selector)
  await sleep(180)
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 900 } }, async (page) => {
  // 1440 physical px ÷ 2 = 720 CSS px; 900 physical px ÷ 2 = 450 CSS px.
  await page.client.send('Emulation.setDeviceMetricsOverride', { ...viewport, mobile: false })
  for (const route of ['/', '/community.html']) {
    await page.navigate(`${base}${route}`)
    await page.waitForExpression('innerWidth === 720 && innerHeight === 450 && devicePixelRatio === 2', { timeoutMs: 8000, label: '200% viewport proxy' })
    if (route === '/community.html') await page.setMembership('member')
    const metrics = await pageMetrics(page)
    step(`Z200-${route === '/' ? 'A' : 'B'}-viewport`, '720×450 CSS viewport, DPR 2, no horizontal overflow', metrics,
      metrics.innerWidth === 720 && metrics.innerHeight === 450 && metrics.dpr === 2
        && metrics.documentScroll <= metrics.innerWidth + 1 && metrics.bodyScroll <= metrics.innerWidth + 1)

    const trigger = route === '/' ? '.topbar .icon-button' : '.help-toggle'
    const dialog = route === '/' ? '.help-modal' : '.help-dialog'
    await page.eval((sel) => { const button = document.querySelector(sel); button?.focus(); button?.click() }, trigger)
    await page.waitForSelector(dialog)
    const open = await dialogMetrics(page, dialog)
    const expectedFocus = await page.eval(() => document.activeElement?.innerText?.trim() || '')
    step(`Z200-${route === '/' ? 'A' : 'B'}-dialog-fit`, '对话框位于视口内且初始焦点留在对话框中', { ...open, expectedFocus },
      open.found && open.withinViewport && open.focusInside && open.pageScrollWidth <= viewport.width + 1)
    await page.screenshot(join(evidenceDir, `zoom-proxy-${route === '/' ? 'aplus' : 'community'}-dialog.png`))
    await escapeDialog(page, dialog)
    const closed = await page.eval((sel, triggerSelector) => ({
      closed: !document.querySelector(sel),
      focusBack: document.activeElement === document.querySelector(triggerSelector),
      overflow: document.documentElement.scrollWidth - innerWidth,
    }), dialog, trigger)
    step(`Z200-${route === '/' ? 'A' : 'B'}-keyboard-return`, 'Esc 关闭弹层、焦点归还、页面无横向溢出', closed,
      closed.closed && closed.focusBack && closed.overflow <= 1)

    if (route === '/community.html') {
      await page.clickByText('消息', { selector: '.mobile-nav button, .side-nav button', exact: false })
      await page.waitForSelector('.messages-page')
      const messages = await pageMetrics(page)
      const guide = await page.eval(() => {
        const card = document.querySelector('.message-first-run')
        const r = card?.getBoundingClientRect()
        return { visible: !!card && r.width > 0, left: r ? Math.round(r.left) : -1, right: r ? Math.round(r.right) : -1, text: card?.innerText?.slice(0, 110) || '' }
      })
      step('Z200-B-message-empty', '消息页首次引导在 200% 代理视口可读且不溢出', { metrics: messages, guide },
        messages.documentScroll <= messages.innerWidth + 1 && messages.bodyScroll <= messages.innerWidth + 1
          && guide.visible && guide.left >= -1 && guide.right <= messages.innerWidth + 1)
      await page.screenshot(join(evidenceDir, 'zoom-proxy-messages-empty.png'))
    }
  }
})
await writeFile(join(evidenceDir, 'zoom-200-proxy-run-record.json'), JSON.stringify({ base, viewport, steps, failures, note: 'Automated CSS viewport/DPR proxy only; genuine browser zoom at 1440×900 remains a manual check.' }, null, 2))
console.log(`200% zoom layout proxy: ${steps.length - failures}/${steps.length} passed (manual browser zoom still required).`)
if (failures) process.exitCode = 1

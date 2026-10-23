// Structural snapshot for the A+ workbench: captures normalized outerHTML of a fixed
// set of UI states so a refactor can prove it did not change the rendered DOM.
// Run: node tools/snapshot-dom.mjs --base=http://127.0.0.1:5180 --out=dom-before.json
// Compare: node tools/snapshot-dom.mjs --base=http://127.0.0.1:5180 --out=dom-after.json
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const base = arg('base', 'http://127.0.0.1:5180').replace(/\/$/, '')
const out = resolve(__dirname, '..', arg('out', 'tools/dom-snapshot.json'))

// Kept as a string expression: cdp.eval serializes functions, which cannot reference closures.
const NORMALIZER = `(() => {
  const root = document.querySelector('.app-shell')
  if (!root) return ''
  const clone = root.cloneNode(true)
  const all = [clone, ...clone.querySelectorAll('*')]
  for (const node of all) {
    for (const name of Array.from(node.getAttributeNames())) {
      if (name.startsWith('data-v-')) node.removeAttribute(name)
    }
    if (node.tagName === 'TEXTAREA' && node.hasAttribute('style')) node.removeAttribute('style')
  }
  // Toast copy is timer dependent; keep the element, drop the text.
  clone.querySelectorAll('.toast').forEach((node) => { node.textContent = '{toast}' })
  return clone.outerHTML.replace(/>\\s+</g, '><').trim()
})()`

const shots = []
async function capture(page, name) {
  const html = await page.eval(NORMALIZER)
  shots.push({ name, length: html.length, html })
  console.log(`[CAPTURE] ${name} — ${html.length} chars`)
}

/** Click the first button whose visible text matches, scoped by selector. */
async function clickText(page, selector, text, { optional = false } = {}) {
  const ok = await page.eval((sel, label) => {
    const node = Array.from(document.querySelectorAll(sel))
      .find((item) => (item.textContent || '').includes(label) && !item.hasAttribute('disabled'))
    if (!node) return false
    node.click()
    return true
  }, selector, text)
  if (!ok && !optional) throw new Error(`clickText(${selector}, ${text}) failed`)
  await sleep(260)
  return ok
}

await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.app-shell')
  await sleep(400)
  await capture(page, 'intake-default')

  await clickText(page, '.filters .filter', '待分诊')
  await capture(page, 'intake-filter-triage')
  await clickText(page, '.filters .filter', '全部记录')

  await clickText(page, '.heading-actions .button', '新建演练记录')
  await capture(page, 'dialog-create')
  await clickText(page, '.modal-footer .button', '取消')

  await clickText(page, '.detail-actions .button', '更新登记状态')
  await capture(page, 'dialog-transition')
  await clickText(page, '.modal-footer .button', '取消')

  await clickText(page, '.detail-actions .button', '更新登记检查点')
  await capture(page, 'dialog-checkpoint')
  await clickText(page, '.modal-footer .button', '取消')

  await clickText(page, '.detail-head-side .detail-link', '提交投诉')
  await capture(page, 'dialog-complaint')
  await clickText(page, '.modal-footer .button', '取消')

  // The remaining action buttons depend on checkpoint readiness in fixture data;
  // capture them only when the dialog actually opens.
  const extra = [
    { label: '记录模拟联系', name: 'dialog-contact-simulation', selector: '.detail-actions .button' },
    { label: '标记高风险', name: 'dialog-high-risk', selector: '.detail-actions .button' },
    { label: '调整跟进', name: 'dialog-follow-up', selector: '.detail-actions .button' },
  ]
  for (const item of extra) {
    const opened = await clickText(page, item.selector, item.label, { optional: true })
    if (!opened) {
      console.log(`[SKIP] ${item.name} — button unavailable in fixture state`)
      continue
    }
    await capture(page, item.name)
    await clickText(page, '.modal-footer .button', '取消', { optional: true })
  }

  await clickText(page, '.heading-actions .button', '社区求助')
  await capture(page, 'dialog-community-bridge')
  await clickText(page, '.modal-footer .button', '关闭')

  await page.eval(() => document.querySelector('.top-actions .icon-button')?.click())
  await sleep(300)
  await capture(page, 'dialog-help')
  await page.eval(() => document.querySelector('.help-modal [data-autofocus]')?.click())
  await sleep(260)

  await page.eval(() => document.querySelector('.complaint-grid .queue-item')?.click())
  await sleep(260)
  await capture(page, 'complaint-selected')

  await page.eval(() => {
    const select = document.querySelector('.role-select select')
    if (!select) return
    select.value = 'demo-review'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(260)
  await capture(page, 'role-review')
})

await mkdir(dirname(out), { recursive: true })
await writeFile(out, JSON.stringify({ base, shots }, null, 2), 'utf8')
console.log(`saved ${shots.length} snapshots → ${out}`)

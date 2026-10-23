import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-p1-followups')
const base = (process.argv.find((arg) => arg.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0
function step(id, expected, actual, ok) {
  steps.push({ id, expected, actual, ok })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${JSON.stringify(actual)}`)
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  const storageBefore = await page.eval(() => JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])))
  await page.clickNav('消息')
  await page.waitForSelector('.messages-page')
  await sleep(300)
  const state = await page.eval(() => {
    const guide = document.querySelector('.messages-page .thread-list > .message-first-run')
    return {
      found: !!guide, ordersContainer: !!document.querySelector('.messages-page .thread-list'),
      tab: document.querySelector('.side-nav button[aria-current="page"]')?.innerText?.trim() || '',
      label: guide?.querySelector('.message-first-run-label')?.innerText?.trim() || '',
      heading: guide?.querySelector('h3')?.innerText?.trim() || '',
      copy: guide?.querySelectorAll('p')[1]?.innerText?.trim() || '',
      threadItems: document.querySelectorAll('.messages-page .thread-list .thread-item').length,
      action: guide?.querySelector('button')?.innerText?.trim() || '',
    }
  })
  step('MFG1-first-run-guide', '明确标注合成数据、说明订单留言出现条件并提供下一步', state,
    state.found && state.ordersContainer && state.label.includes('首次使用') && state.copy.includes('合成')
      && state.heading.includes('订单留言') && state.copy.includes('本机')
      && state.copy.includes('不会向外发送') && state.action === '去看待接单求助')
  const storageAfter = await page.eval(() => JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])))
  step('MFG2-no-seed-or-storage-write', '空态引导不创建订单或写入存档',
    { threadItems: state.threadItems, storageUnchanged: storageBefore === storageAfter },
    state.threadItems === 0 && storageBefore === storageAfter)
  step('MFG3-empty-search-state-remains-distinct', '首访引导仅在无订单且无搜索时展示',
    await page.eval(() => ({ guide: !!document.querySelector('.message-first-run'), search: document.querySelector('.message-search-row input')?.value ?? '' })),
    await page.eval(() => !!document.querySelector('.message-first-run') && !(document.querySelector('.message-search-row input')?.value ?? '').trim()))
  for (const [index, size] of [
    { width: 320, height: 844, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 720, height: 900, mobile: true },
    { width: 1024, height: 900, mobile: false },
    { width: 1440, height: 1000, mobile: false },
  ].entries()) {
    await page.client.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile })
    await sleep(140)
    const responsive = await page.eval(() => {
      const card = document.querySelector('.messages-page .thread-list > .message-first-run')
      const rect = card?.getBoundingClientRect()
      return {
        innerWidth, innerHeight, documentScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth,
        cardVisible: !!card && rect.width > 0, cardLeft: rect ? Math.round(rect.left) : -1, cardRight: rect ? Math.round(rect.right) : -1,
      }
    })
    step(`MFG${index + 4}-responsive-${size.width}`, '引导卡在目标宽度可见且两入口页面没有横向溢出', responsive,
      responsive.innerWidth === size.width && responsive.documentScroll <= size.width + 1 && responsive.bodyScroll <= size.width + 1
        && responsive.cardVisible && responsive.cardLeft >= -1 && responsive.cardRight <= size.width + 1)
  }
  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(120)
  await page.screenshot(join(evidenceDir, 'messages-first-run-guide.png'))
})
await writeFile(join(evidenceDir, 'messages-first-run-run-record.json'), JSON.stringify({ base, steps, failures }, null, 2))
console.log(`Messages first-run guide regression: ${steps.length - failures}/${steps.length} passed.`)
if (failures) process.exitCode = 1

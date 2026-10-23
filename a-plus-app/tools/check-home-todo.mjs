// Round 8 verification: home "my todo" shortcuts + safety dialog background inert.
// Run: node tools/check-home-todo.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-home-todo')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `home-${name}.png`)
  await page.screenshot(file)
  return file
}
async function clickCardButton(page, cardText, label) {
  const result = await page.eval((text, wanted) => {
    const norm = (v) => (v || '').replace(/\s+/g, ' ').trim()
    const card = Array.from(document.querySelectorAll('.post-card')).find((node) => norm(node.innerText).includes(text))
    const button = card && Array.from(card.querySelectorAll('button')).find((node) => norm(node.innerText) === wanted && !node.disabled)
    if (!button) return { ok: false }
    button.scrollIntoView({ block: 'center' })
    button.click()
    return { ok: true }
  }, cardText, label)
  if (!result?.ok) throw new Error(`clickCardButton ${cardText}/${label} failed`)
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('member')
  await page.waitForSelector('.home-todo')
  const initial = await page.eval(() => ({
    tiles: document.querySelectorAll('.home-todo button').length,
    labels: Array.from(document.querySelectorAll('.home-todo small')).map((node) => node.innerText.trim()),
    values: Array.from(document.querySelectorAll('.home-todo strong')).map((node) => node.innerText.trim()),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('H1', '首页我的待办初始态', '3 个待办入口、计数为 0、无横向溢出',
    `tiles=${initial.tiles} labels=${initial.labels.join('/')} values=${initial.values.join('/')} overflow=${initial.overflow}`,
    initial.tiles === 3 && initial.values.every((value) => value === '00') && initial.overflow <= 1,
    await shot(page, 'h1-home-todo'))

  // seed: accept a fixture help + sign up for the activity, then go home
  await page.clickByText('社区', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.post-card')
  await clickCardButton(page, '帮忙把两箱演练物资', '演练接单')
  await page.waitForText('已接单（本机演练）')
  await clickCardButton(page, '周六步道清洁', '演练报名')
  await page.waitForText('取消演练报名')
  await page.clickByText('首页', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.home-todo')
  await sleep(250)
  const seeded = await page.eval(() => ({
    values: Array.from(document.querySelectorAll('.home-todo strong')).map((node) => node.innerText.trim()),
  }))
  step('H2', '待办计数随本机状态更新', '进行中订单=01、已报名活动=01、未读通知仍为 00',
    `values=${seeded.values.join('/')}`,
    seeded.values[0] === '01' && seeded.values[2] === '01' && seeded.values[1] === '00',
    await shot(page, 'h2-home-todo-seeded'))

  await page.clickByText('进行中订单', { selector: '.home-todo button', exact: false })
  await page.waitForText('我的发布')
  const navProfile = await page.bodyText()
  step('H3', '待办入口跳转“我的”', '点击进行中订单进入“我的”页',
    `hasProfile=${navProfile.includes('我的发布')}`, navProfile.includes('我的发布'),
    await shot(page, 'h3-todo-profile'))

  await page.clickByText('首页', { selector: '.side-nav button', exact: false })
  await page.waitForSelector('.home-todo')
  await page.clickByText('查看说明', { selector: '.care-strip button', exact: false })
  await page.waitForSelector('#safety-title')
  const inert = await page.eval(() => document.querySelector('.home-main-content')?.inert === true)
  await page.eval(() => document.querySelector('#safety-title')?.closest('.dialog-card')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await sleep(300)
  const after = await page.eval(() => ({
    closed: !document.querySelector('#safety-title'),
    inert: document.querySelector('.home-main-content')?.inert === true,
    focusReturned: (document.activeElement?.innerText || '').includes('查看说明'),
  }))
  step('H4', '安全说明打开时背景 inert', '主内容 inert、Esc 关闭后恢复、焦点归还',
    `openInert=${inert} closed=${after.closed} afterInert=${after.inert} focus=${after.focusReturned}`,
    inert && after.closed && !after.inert && after.focusReturned,
    await shot(page, 'h4-safety-inert'))

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const mobile = await page.eval(() => {
    const grid = document.querySelector('.home-todo')
    const cells = Array.from(document.querySelectorAll('.home-todo button'))
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      minHeight: cells.length ? Math.min(...cells.map((cell) => Math.round(cell.getBoundingClientRect().height))) : 0,
      minWidth: cells.length ? Math.min(...cells.map((cell) => Math.round(cell.getBoundingClientRect().width))) : 0,
    }
  })
  // 2026-10-21 产品级重构：单列会把首条动态压出首屏，改为三列紧凑摘要；
  // 验收改为「三列 + 每个入口 >=44x44 + 无横向溢出」，可点性不降低。
  step('H5', '移动端待办三列紧凑且可点', '390px 下待办三列、每项 >=44x44、无横向溢出',
    `columns=${mobile.columns} size=${mobile.minWidth}x${mobile.minHeight} overflow=${mobile.overflow}`,
    mobile.columns === 3 && mobile.minHeight >= 44 && mobile.minWidth >= 44 && mobile.overflow <= 1,
    await shot(page, 'h5-todo-mobile'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  await writeFile(join(evidenceDir, 'home-todo-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})

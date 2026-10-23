// Moderation workbench summary tiles: counts, jump/focus, mobile grid.
// Run: node tools/check-workbench.mjs --base=http://127.0.0.1:5180
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, sleep } from './cdp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(resolve(__dirname, '..'), '..', 'docs', '运营准备', 'evidence-workbench')
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=http://127.0.0.1:5180').slice(7).replace(/\/$/, '')
const steps = []
let failures = 0

function step(id, name, expected, actual, ok, shotFile) {
  steps.push({ id, name, expected, actual, ok, shot: shotFile ?? '' })
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${actual}`)
}
async function shot(page, name) {
  const file = join(evidenceDir, `workbench-${name}.png`)
  await page.screenshot(file)
  return file
}
async function focusTile(page, label) {
  await page.clickByText(label, { selector: '.workbench-tile', exact: false })
  await sleep(350)
  return page.eval(() => ({
    activeId: document.activeElement?.id ?? '',
    commentFilter: document.querySelector('.comments-filter button[aria-selected="true"]')?.innerText ?? '',
    reportFilter: document.querySelector('.reports-filter button[aria-selected="true"]')?.innerText ?? '',
    messageFilter: document.querySelector('.messages-filter button[aria-selected="true"]')?.innerText ?? '',
  }))
}

await mkdir(evidenceDir, { recursive: true })
await withBrowser({ windowSize: { width: 1440, height: 1000 } }, async (page) => {
  await page.navigate(`${base}/community.html`)
  await page.clearLocalStorage()
  await page.reload()
  await page.waitForSelector('.community-app')
  await page.setMembership('reviewer')
  await page.clickByText('审核', { selector: '.side-nav button', exact: false })
  await page.waitForText('内容与举报审核')
  await page.waitForSelector('.moderation-workbench .workbench-tile')
  const initial = await page.eval(() => ({
    tiles: Array.from(document.querySelectorAll('.workbench-tile')).map((node) => ({
      value: node.querySelector('strong')?.innerText ?? '',
      label: node.querySelector('span')?.innerText ?? '',
    })),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))
  step('W1', '工作台概览卡', '4 张卡：待审发布/待审评论/待处理举报/订单留言，计数为两位数',
    `tiles=${initial.tiles.map((tile) => `${tile.label}:${tile.value}`).join('|')} overflow=${initial.overflow}`,
    initial.tiles.length === 4 && initial.tiles.every((tile) => /^\d{2}$/.test(tile.value)) && initial.overflow <= 1,
    await shot(page, 'w1-tiles'))

  const comments = await focusTile(page, '待审评论')
  step('W2', '跳转评论待审', '点击后聚焦评论标题，评论筛选回到待审',
    `active=${comments.activeId} filter=${comments.commentFilter}`,
    comments.activeId === 'moderation-comments' && comments.commentFilter.includes('待审'),
    await shot(page, 'w2-comments'))

  const reports = await focusTile(page, '待处理举报')
  step('W3', '跳转举报待处理', '点击后聚焦举报标题，举报筛选回到待处理',
    `active=${reports.activeId} filter=${reports.reportFilter}`,
    reports.activeId === 'moderation-reports' && reports.reportFilter.includes('待处理'),
    await shot(page, 'w3-reports'))

  const messages = await focusTile(page, '订单留言')
  step('W4', '跳转订单留言', '点击后聚焦留言标题，留言筛选为全部',
    `active=${messages.activeId} filter=${messages.messageFilter}`,
    messages.activeId === 'moderation-messages' && messages.messageFilter.includes('全部'),
    await shot(page, 'w4-messages'))

  const posts = await focusTile(page, '待审发布')
  step('W5', '跳转待审发布', '点击后聚焦待审发布标题',
    `active=${posts.activeId}`, posts.activeId === 'moderation-posts',
    await shot(page, 'w5-posts'))

  await page.client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const mobile = await page.eval(() => {
    const grid = document.querySelector('.moderation-workbench')
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  step('W6', '移动端概览两列', '390px 下两列、无横向溢出',
    `columns=${mobile.columns} overflow=${mobile.overflow}`,
    mobile.columns === 2 && mobile.overflow <= 1,
    await shot(page, 'w6-mobile'))
  await page.client.send('Emulation.clearDeviceMetricsOverride')

  await writeFile(join(evidenceDir, 'workbench-run-record.json'), JSON.stringify({ runAt: new Date().toISOString(), base, steps, failures, pageErrors: page.pageErrors }, null, 2), 'utf8')
  console.log(`\n${steps.length - failures}/${steps.length} passed`)
  if (failures) process.exitCode = 1
})
